import React, { useEffect, useState } from 'react'
import { fetchBooks, createBook, createChapter, getBookById, updateChapter, deleteChapter, login as apiLogin, fetchUsers, updateBook, deleteBook, updateUser, deleteUser, createUser, fetchBanners, createBanner, updateBanner, deleteBanner, fetchStats, fetchGenres, createGenre, updateGenre, deleteGenre, fetchTopupRequests, approveTopupRequest, rejectTopupRequest, adminCreditWallet } from './api'
import { Bar, Doughnut } from 'react-chartjs-2'
import Chart from 'chart.js/auto'

function getToken() {
  try { return localStorage.getItem('admin_token') } catch (e) { return null }
}

function setToken(t) {
  try { localStorage.setItem('admin_token', t) } catch (e) {}
}

function removeToken() {
  try { localStorage.removeItem('admin_token') } catch (e) {}
}

export default function App() {
  const [token, setTokenState] = useState(getToken())
  const [books, setBooks] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [route, setRoute] = useState('dashboard') // 'dashboard' | 'books' | 'users' | 'genres' | 'coins'
  const [bookForm, setBookForm] = useState({ title: '', author: '', description: '', genre: '' })
  // allow storing file locally before upload
  const [coverFile, setCoverFile] = useState(null)
  const [chapterForm, setChapterForm] = useState({ bookId: '', title: '', content: '' })
  const [loginForm, setLoginForm] = useState({ email: '', password: '' })
  const [editBookModal, setEditBookModal] = useState(null) // { id, title, author, description, genre }
  const [editBookCoverFile, setEditBookCoverFile] = useState(null)
  const [editUserModal, setEditUserModal] = useState(null) // { id, fullname, role, email }
  const [createUserModal, setCreateUserModal] = useState(null) // { fullname, email, password, role }
  const [selectedBook, setSelectedBook] = useState(null)
  const [selectedBookLoading, setSelectedBookLoading] = useState(false)
  const [editChapterModal, setEditChapterModal] = useState(null) // { id, title, content }
  const [banners, setBanners] = useState([])
  const [bannerForm, setBannerForm] = useState({ title: '', link: '', enabled: true })
  const [bannerFile, setBannerFile] = useState(null)
  const [editBannerModal, setEditBannerModal] = useState(null)
  const [genres, setGenres] = useState([])
  const [genreForm, setGenreForm] = useState({ name: '', description: '' })
  const [editGenreModal, setEditGenreModal] = useState(null)
  const [stats, setStats] = useState({ books: 0, users: 0, chapters: 0, banners: 0, comments: 0 })
  const [topups, setTopups] = useState([])
  // loading / busy states for actions
  const [isCreatingBook, setIsCreatingBook] = useState(false)
  const [isCreatingBanner, setIsCreatingBanner] = useState(false)
  const [isCreatingChapter, setIsCreatingChapter] = useState(false)
  const [deletingBookId, setDeletingBookId] = useState(null)
  const [deletingChapterId, setDeletingChapterId] = useState(null)
  const [savingChapter, setSavingChapter] = useState(false)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [savingBook, setSavingBook] = useState(false)

  // navigation helper to integrate with browser history (so Back button works)
  async function navigate(to, opts) {
    if (to === 'book' && opts && opts.bookId) {
      setSelectedBookLoading(true)
      try {
        const b = await getBookById(opts.bookId)
        setSelectedBook(b)
        setRoute('book')
        history.pushState({ route: 'book', bookId: opts.bookId }, '', `#book:${opts.bookId}`)
      } catch (err) {
        console.error('navigate book err', err)
        alert('Không thể tải sách')
      } finally {
        setSelectedBookLoading(false)
      }
      return
    }
    if (to === 'chapters' && opts && opts.bookId) {
      setSelectedBookLoading(true)
      try {
        const b = await getBookById(opts.bookId)
        setSelectedBook(b)
        setRoute('chapters')
        history.pushState({ route: 'chapters', bookId: opts.bookId }, '', `#chapters:${opts.bookId}`)
      } catch (err) {
        console.error('navigate chapters err', err)
        alert('Could not load chapters')
      } finally {
        setSelectedBookLoading(false)
      }
      return
    }
    setRoute(to)
    try { history.pushState({ route: to }, '', `#${to}`) } catch(e){}
  }

  // listen to back/forward events
  useEffect(()=>{
    const onPop = async (ev) => {
      const s = ev.state
      if (!s) {
        const hash = location.hash.replace('#','')
        if (!hash) { setRoute('dashboard'); return }
        const [r, id] = hash.split(':')
        if (r === 'book' && id) {
          setSelectedBookLoading(true)
          try { const b = await getBookById(id); setSelectedBook(b); setRoute('book') } catch(e){console.error(e)} finally{setSelectedBookLoading(false)}
        } else { setRoute(r) }
        return
      }
      if (s.route === 'book' && s.bookId) {
        setSelectedBookLoading(true)
        try { const b = await getBookById(s.bookId); setSelectedBook(b); setRoute('book') } catch(e){console.error(e)} finally{setSelectedBookLoading(false)}
      } else if (s.route === 'chapters' && s.bookId) {
        setSelectedBookLoading(true)
        try { const b = await getBookById(s.bookId); setSelectedBook(b); setRoute('chapters') } catch(e){console.error(e)} finally{setSelectedBookLoading(false)}
      } else {
        setRoute(s.route || 'dashboard')
      }
    }
    window.addEventListener('popstate', onPop)
    // initialize from hash if present
    const init = location.hash.replace('#','')
    if (init) {
      const [r,id] = init.split(':')
      if (r === 'book' && id) { (async()=>{ setSelectedBookLoading(true); try{ const b = await getBookById(id); setSelectedBook(b); setRoute('book') } catch(e){console.error(e)} finally{setSelectedBookLoading(false)} })() }
      else setRoute(r)
    }
    return ()=> window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => { if (token) setTokenState(token) }, [])

  useEffect(() => { load() }, [route])

  useEffect(() => {
    if (route === 'book' && selectedBook && selectedBook.id) {
      // nothing - already loaded
    }
  }, [route, selectedBook])

  async function load() {
    setLoading(true)
    try {
      const b = await fetchBooks()
      setBooks(b)
      console.log('[load] Books fetched:', b)
      if (route === 'banners') {
        const bs = await fetchBanners()
        setBanners(Array.isArray(bs) ? bs : [])
      }
      if (route === 'genres') {
        const gs = await fetchGenres()
        setGenres(Array.isArray(gs) ? gs : [])
      }
      if (route === 'books') {
        // Load genres for the dropdown in create/edit book forms
        const gs = await fetchGenres()
        setGenres(Array.isArray(gs) ? gs : [])
      }
      if (route === 'dashboard') {
        try {
          const s = await fetchStats()
          if (s) setStats(s)
        } catch (e) { console.error('fetchStats err', e) }
      }
      if (route === 'users') {
        const u = await fetchUsers()
        setUsers(Array.isArray(u) ? u : [])
      }
      if (route === 'coins') {
        const t = await fetchTopupRequests()
        setTopups(Array.isArray(t) ? t : [])
      }
    } catch (err) {
      console.error(err)
      alert('Không thể kết nối tới server')
    } finally {
      setLoading(false)
    }
  }

  async function reloadTopups() {
    try {
      const t = await fetchTopupRequests()
      setTopups(Array.isArray(t) ? t : [])
    } catch (err) {
      console.error('reloadTopups err', err)
    }
  }

  async function handleApproveTopup(req) {
    const defaultCoins = req && req.coins ? req.coins : 0
    const coinsStr = window.prompt('Số xu nạp cho người dùng', String(defaultCoins))
    if (coinsStr === null) return
    const coins = Number(coinsStr)
    if (!coins || coins <= 0) return alert('Số xu phải lớn hơn 0')
    const note = window.prompt('Ghi chú duyệt (tùy chọn)', '')
    try {
      const res = await approveTopupRequest(req.request_id, { coins, admin_note: note || undefined })
      if (res && res.success) {
        alert('Đã duyệt và cộng xu')
        reloadTopups()
      } else {
        alert('Duyệt thất bại: ' + (res && (res.error || res.message) || 'unknown'))
      }
    } catch (err) {
      console.error('approve topup err', err)
      alert('Không thể duyệt top-up')
    }
  }

  async function handleRejectTopup(req) {
    const note = window.prompt('Lý do từ chối', '')
    if (note === null) return
    try {
      const res = await rejectTopupRequest(req.request_id, { admin_note: note || undefined })
      if (res && res.success) {
        alert('Đã từ chối yêu cầu')
        reloadTopups()
      } else {
        alert('Từ chối thất bại: ' + (res && (res.error || res.message) || 'unknown'))
      }
    } catch (err) {
      console.error('reject topup err', err)
      alert('Không thể từ chối top-up')
    }
  }

  async function onCreateBook(e) {
    e.preventDefault()
    if (!bookForm.title) return alert('Title required')
    // attach coverFile if selected
    const payload = { ...bookForm }
    if (coverFile) payload.coverFile = coverFile
    setIsCreatingBook(true)
    try {
      const res = await createBook(payload)
      if (res && !res.error) {
        alert('✅ Tạo sách thành công!')
        setBookForm({ title: '', author: '', description: '', genre: '' })
        setCoverFile(null)
        load()
      } else {
        alert('❌ Tạo sách thất bại: ' + (res?.error || 'Lỗi không xác định'))
      }
    } catch (err) {
      console.error('createBook err', err)
      alert('❌ Tạo sách thất bại')
    } finally {
      setIsCreatingBook(false)
    }
  }

  async function loadBanners() {
    try {
      const bs = await fetchBanners()
      setBanners(Array.isArray(bs) ? bs : [])
    } catch (err) {
      console.error('load banners err', err)
      setBanners([])
    }
  }

  async function onCreateBanner(e) {
    e.preventDefault()
    if (!bannerForm.title) return alert('Title required')
    const payload = { ...bannerForm }
    if (bannerFile) payload.bannerFile = bannerFile
    setIsCreatingBanner(true)
    try {
      const res = await createBanner(payload)
      if (res && res.id) {
        alert('Banner created')
        setBannerForm({ title: '', link: '', enabled: true })
        setBannerFile(null)
        loadBanners()
      } else {
        alert(res.error || 'Create banner failed')
      }
    } catch (err) {
      console.error('createBanner err', err)
      alert('Create banner failed')
    } finally {
      setIsCreatingBanner(false)
    }
  }

  async function handleEditBannerSubmit(payload) {
    const id = payload.id
    const data = { title: payload.title, link: payload.link, enabled: payload.enabled }
    if (payload.bannerFile) data.bannerFile = payload.bannerFile
    try {
      const res = await updateBanner(id, data)
      if (res && res.id) {
        alert('Banner updated')
        setEditBannerModal(null)
        loadBanners()
      } else {
        alert(res.error || 'Update banner failed')
      }
    } catch (err) {
      console.error('updateBanner err', err)
      alert('Update banner failed')
    }
  }

  async function handleDeleteBanner(b) {
    if (!confirm(`Delete banner "${b.title}"?`)) return
    const res = await deleteBanner(b.id)
    if (res && (res.affectedRows !== undefined ? res.affectedRows > 0 : true)) {
      alert('Deleted')
      loadBanners()
    } else {
      alert(res.error || 'Delete failed')
    }
  }

  async function handleLogin(e) {
    e.preventDefault()
    try {
      setIsLoggingIn(true)
      const res = await apiLogin(loginForm)
      if (res && res.token) {
        setToken(res.token)
        setTokenState(res.token)
        alert('Đăng nhập thành công')
      } else {
        alert(res.error || 'Login failed')
      }
    } catch (err) {
      console.error(err)
      alert('Login error')
    } finally {
      setIsLoggingIn(false)
    }
  }

  function handleLogout() {
    removeToken()
    setTokenState(null)
  }

  async function onCreateChapter(e) {
    e.preventDefault()
    if (!chapterForm.bookId) return alert('Select book')
    if (!chapterForm.title || !chapterForm.content) return alert('Title & content required')
    setIsCreatingChapter(true)
    try {
      await createChapter(chapterForm.bookId, { title: chapterForm.title, content: chapterForm.content })
      setChapterForm({ bookId: '', title: '', content: '' })
      load()
    } catch (err) {
      console.error('createChapter err', err)
      alert('Create chapter failed')
    } finally {
      setIsCreatingChapter(false)
    }
  }

  async function openBook(bookId) {
    // navigate to book detail and push history
    await navigate('book', { bookId })
  }

  async function openChaptersForBook(bookId) {
    await navigate('chapters', { bookId })
  }

  function handleEditChapter(ch) {
    setEditChapterModal({ id: ch.id, title: ch.title || '', content: ch.content || '' })
  }

  async function submitEditChapter(payload) {
    if (!selectedBook || !selectedBook.id) return alert('No book selected')
    try {
      setSavingChapter(true)
      await updateChapter(selectedBook.id, payload.id, { title: payload.title, content: payload.content })
      // refresh book
      const b = await getBookById(selectedBook.id)
      setSelectedBook(b)
      setEditChapterModal(null)
      alert('Chapter updated')
    } catch (err) {
      console.error('update chapter err', err)
      alert('Could not update chapter')
    } finally {
      setSavingChapter(false)
    }
  }

  async function handleDeleteChapter(ch) {
    if (!selectedBook || !selectedBook.id) return alert('No book selected')
    if (!confirm(`Delete chapter "${ch.title}"? This cannot be undone.`)) return
    try {
      setDeletingChapterId(ch.id)
      await deleteChapter(selectedBook.id, ch.id)
      const b = await getBookById(selectedBook.id)
      setSelectedBook(b)
      alert('Deleted')
    } catch (err) {
      console.error('delete chapter err', err)
      alert('Delete failed')
    } finally {
      setDeletingChapterId(null)
    }
  }

  function handleEditBook(b) {
    setEditBookModal({ id: b.id, title: b.title || '', author: b.author || '', description: b.description || '', genre: b.genre || '' })
  }

  async function submitEditBook(payload) {
    // Save edit with error handling and UI feedback
    try {
      // optimistic UI: show saving state
      setSavingBook && setSavingBook(true)
    } catch (e) {}
    try {
      const updateData = { title: payload.title, author: payload.author, description: payload.description, genre: payload.genre }
      if (payload.coverFile) updateData.coverFile = payload.coverFile
      const res = await updateBook(payload.id, updateData)
      // backend returns { error: '...' } on failure or the updated book on success
      if (!res) return alert('❌ Không nhận được phản hồi từ server')
      if (res.error) {
        // common cause: 401/403 if not authenticated as admin
        return alert('❌ Cập nhật thất bại: ' + (res.error || 'unknown'))
      }
      // success
      alert('✅ Cập nhật sách thành công!')
      setEditBookModal(null)
      load()
    } catch (err) {
      console.error('submitEditBook err', err)
      alert('❌ Không thể cập nhật sách. Kiểm tra xem bạn đã đăng nhập admin chưa.')
    } finally {
      try { setSavingBook && setSavingBook(false) } catch (e) {}
    }
  }

  async function handleDeleteBook(b) {
    if (!confirm(`Xóa sách "${b.title}"? Hành động này không thể hoàn tác.`)) return
    setDeletingBookId(b.id)
    try {
      const res = await deleteBook(b.id)
      if (res && !res.error) {
        alert('✅ Xóa sách thành công!')
        load()
      } else {
        alert('❌ Xóa sách thất bại: ' + (res?.error || 'Lỗi không xác định'))
      }
    } catch (err) {
      console.error('deleteBook err', err)
      alert('❌ Xóa sách thất bại')
    } finally {
      setDeletingBookId(null)
    }
  }

  function handleEditUser(u) {
    setEditUserModal({ id: u.id, fullname: u.fullname || '', role: u.role || 'user', email: u.email || '' })
  }

  async function submitEditUser(payload) {
    await updateUser(payload.id, { fullname: payload.fullname, role: payload.role, email: payload.email })
    setEditUserModal(null)
    load()
  }

  async function handleCreateUserSubmit(payload) {
    if (!payload || !payload.email || !payload.password) return alert('Email và mật khẩu là bắt buộc')
    await createUser({ fullname: payload.fullname, email: payload.email, password: payload.password, role: payload.role })
    setCreateUserModal(null)
    load()
  }

  async function handleDeleteUser(u) {
    if (u.role === 'admin') { alert('Không thể xóa tài khoản admin.'); return }
    if (!confirm(`Delete user ${u.email}? This cannot be undone.`)) return
    await deleteUser(u.id)
    load()
  }

  async function handleAdminTopupUser(u) {
    const coinsStr = window.prompt(`Nạp xu cho ${u.email}`, '100')
    if (coinsStr === null) return
    const coins = Number(coinsStr)
    if (!coins || coins <= 0) return alert('Số xu phải lớn hơn 0')
    const note = window.prompt('Ghi chú (tùy chọn)', '')
    try {
      const res = await adminCreditWallet(u.id, coins, note || undefined)
      if (res && res.success) {
        alert('Đã nạp xu thành công')
      } else {
        alert('Nạp xu thất bại: ' + (res && (res.error || res.message) || 'unknown'))
      }
    } catch (err) {
      console.error('admin topup err', err)
      alert('Không thể nạp xu')
    }
  }

  return (
    <div className="site">
      <div className="container">
        <aside className="sidebar">
          <div className="logo">Reader Admin</div>
          <div className="muted">Quản lý nội dung & chương</div>
          <nav className="nav">
            <a href="#" onClick={e=>{e.preventDefault(); setRoute('dashboard')}} className={route==='dashboard'? 'active':''}>Dashboard</a>
            <a href="#" onClick={e=>{e.preventDefault(); setRoute('books')}} className={route==='books'? 'active':''}>Books</a>
            <a href="#" onClick={e=>{e.preventDefault(); setRoute('chapters')}}>Chapters</a>
            <a href="#" onClick={e=>{e.preventDefault(); setRoute('banners')}} className={route==='banners'? 'active':''}>Banners</a>
            <a href="#" onClick={e=>{e.preventDefault(); setRoute('genres')}} className={route==='genres'? 'active':''}>Genres</a>
            {/* New Book moved into Books page */}
            <a href="#" onClick={e=>{e.preventDefault(); setRoute('users')}} className={route==='users'? 'active':''}>Users</a>
            <a href="#" onClick={e=>{e.preventDefault(); setRoute('coins')}} className={route==='coins'? 'active':''}>Coins</a>
            <a href="#" onClick={e=>{e.preventDefault(); setRoute('settings')}}>Settings</a>
          </nav>

          {!token && (
            <div style={{ marginTop: 12 }}>
              <a href="/login.html" style={{ display: 'block', marginBottom: 8, color: '#8b5e34', fontWeight: 700 }}>Đăng nhập</a>
              <a href="/register.html" style={{ display: 'block', color: '#8b5e34', fontWeight: 700 }}>Đăng ký admin</a>
            </div>
          )}
        </aside>

        <main className="main">
          <div className="header">
            <div className="title">Bảng điều khiển — Reader</div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div className="muted">{books.length} sách • {books.reduce((s,b)=>s+(b.chapters?b.chapters.length:0),0)} chương</div>
              <div style={{marginLeft:12}} className="muted">Thu nhập: {typeof stats.income === 'number' ? new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND'}).format(stats.income) : stats.income}</div>
              {token ? (
                <button className="btn btn-ghost" onClick={handleLogout}>Đăng xuất</button>
              ) : null}
            </div>
          </div>

          {route === 'dashboard' && (
            <>
              <section className="panel">
                <h3>Statistics</h3>
                <div style={{display:'flex',gap:18,alignItems:'stretch',flexWrap:'wrap'}}>
                  <div style={{flex:1,minWidth:300,background:'#fffefc',padding:12,borderRadius:8}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                      <div style={{fontWeight:700}}>Top truyện được đọc</div>
                      <div className="small muted">Dựa trên số độc giả (reading_history)</div>
                    </div>
                    {stats.top_books && stats.top_books.length > 0 ? (
                      <Bar data={{ labels: stats.top_books.map(b=>b.title), datasets: [{ label: 'Readers', backgroundColor: '#8b5e34', data: stats.top_books.map(b=>b.readers) }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} height={200} />
                    ) : (
                      <div style={{padding:18}} className="muted">Chưa có dữ liệu đọc (reading_history trống)</div>
                    )}
                  </div>

                  <div style={{width:260,minWidth:260,background:'#fffefc',padding:12,borderRadius:8,display:'flex',flexDirection:'column',gap:8}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <div>
                        <div className="small muted">Người dùng mới hôm nay</div>
                        <div style={{fontSize:18,fontWeight:800}}>{stats.new_users_today || 0}</div>
                      </div>
                      <div>
                        <div className="small muted">7 ngày</div>
                        <div style={{fontSize:16,fontWeight:700}}>{stats.new_users_7d || 0}</div>
                      </div>
                    </div>
                    <div style={{height:10}} />
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <div>
                        <div className="small muted">Active (24h)</div>
                        <div style={{fontSize:18,fontWeight:800}}>{stats.active_users_24h || 0}</div>
                      </div>
                      <div>
                        <div className="small muted">Active (15m)</div>
                        <div style={{fontSize:16,fontWeight:700}}>{stats.active_users_15m || 0}</div>
                      </div>
                    </div>
                    <div style={{height:1,background:'#efe6db',margin:'8px 0'}} />
                    <div>
                      <div className="small muted">Người dùng VIP</div>
                      <div style={{fontSize:18,fontWeight:800,color:'#d2691e'}}>{stats.vip_users || 0}</div>
                    </div>
                    <div>
                      <div className="small muted">Authors</div>
                      <div style={{fontSize:16,fontWeight:700}}>{stats.authors || 0}</div>
                    </div>
                  </div>

                  <div style={{width:240,minWidth:240,background:'#fffefc',padding:12,borderRadius:8,display:'flex',flexDirection:'column',justifyContent:'center',alignItems:'center'}}>
                    <div style={{fontSize:14,color:'#333',marginBottom:6,fontWeight:700}}>Thu nhập từ Mobile App</div>
                    <div style={{fontSize:20,fontWeight:800,color:'#8b5e34'}}>{typeof stats.income === 'number' ? new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND'}).format(stats.income) : (stats.income || '0')}</div>
                    <div className="small muted" style={{marginTop:8,textAlign:'center'}}>Tổng thu nhập từ bảng payments (nếu có)</div>
                  </div>
                </div>
              </section>
              {/* Quick links and quick actions moved into Books page */}

              <section className="panel">
                <h3>Recent Books</h3>
                {loading ? <p>Loading...</p> : (
                  <div className="books-grid">
                    {books.map(b => (
                      <div key={b.id} className="book-card">
                        <div className="cover">
                          {b.cover_url ? (
                            <img src={b.cover_url} alt={b.title} style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6 }} />
                          ) : (
                            (b.title ? b.title.charAt(0).toUpperCase() : 'B')
                          )}
                        </div>
                        <div className="book-info">
                          <h3 style={{cursor:'pointer'}} onClick={()=>openBook(b.id)}>{b.title}</h3>
                          <div className="meta"><span className="small">{b.author || 'Không rõ tác giả'}</span></div>
                          <div className="muted">{b.description || <span className="small muted">(Chưa có mô tả)</span>}</div>
                          <div style={{marginTop:8}} className="small">Chapters: {b.chapters ? b.chapters.length : 0}</div>
                          <div style={{marginTop:8}}>
                            {/* Open button removed - use Chapters button or click title to open */}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

          {route === 'banners' && (
            <section className="panel">
              <h3>Banners</h3>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
                <div>
                  <form onSubmit={onCreateBanner}>
                    <label>Title</label>
                    <input value={bannerForm.title} onChange={e=>setBannerForm({...bannerForm,title:e.target.value})} />
                    <label>Link</label>
                    <input value={bannerForm.link} onChange={e=>setBannerForm({...bannerForm,link:e.target.value})} placeholder="https://..." />
                    <label>Enabled</label>
                    <select value={bannerForm.enabled ? '1' : '0'} onChange={e=>setBannerForm({...bannerForm,enabled: e.target.value === '1'})}>
                      <option value="1">Enabled</option>
                      <option value="0">Disabled</option>
                    </select>
                    <label>Image</label>
                    <input type="file" accept="image/*" onChange={e=>setBannerFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)} />
                    {bannerFile && (<div style={{marginTop:8}}><img src={URL.createObjectURL(bannerFile)} alt="preview" style={{maxWidth:240}} /></div>)}
                    <div style={{display:'flex',justifyContent:'flex-end'}}>
                      <button type="submit" disabled={isCreatingBanner} className={isCreatingBanner ? 'btn btn-primary disabled' : 'btn btn-primary'}>{isCreatingBanner ? 'Creating...' : 'Create Banner'}</button>
                    </div>
                  </form>
                </div>
                <div>
                  <h4>Existing Banners</h4>
                  {banners.length === 0 ? <p>No banners</p> : (
                    <div style={{display:'grid',gap:12}}>
                      {banners.map(b => (
                        <div key={b.id} style={{display:'flex',gap:12,alignItems:'center',background:'#fffefc',padding:8,borderRadius:8}}>
                          <div style={{width:120,height:60,background:'#f2f0ec',display:'flex',alignItems:'center',justifyContent:'center'}}>
                            {b.image_url ? <img src={b.image_url} style={{maxWidth:'100%',maxHeight:'100%'}} alt={b.title} /> : 'No image'}
                          </div>
                          <div style={{flex:1}}>
                            <div style={{fontWeight:700}}>{b.title}</div>
                            <div className="small muted">{b.link}</div>
                          </div>
                          <div style={{display:'flex',flexDirection:'column',gap:6}}>
                            <button className="btn btn-edit btn-small" onClick={()=>setEditBannerModal({...b, bannerFile: null})}>Edit</button>
                            <button onClick={()=>handleDeleteBanner(b)} style={{background:'#ff6b6b'}} disabled={false}>Delete</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {route === 'coins' && (
            <section className="panel">
              <h3>Yêu cầu nạp xu</h3>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <div className="muted">Người dùng tạo lệnh nạp, admin duyệt để cộng xu.</div>
                <button className="btn" onClick={reloadTopups}>Refresh</button>
              </div>
              {topups.length === 0 ? (
                <div className="muted" style={{padding:12}}>Chưa có yêu cầu.</div>
              ) : (
                <div style={{overflowX:'auto'}}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>User</th>
                        <th>Xu</th>
                        <th>Số tiền</th>
                        <th>Phương thức</th>
                        <th>Trạng thái</th>
                        <th>Ngày tạo</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {topups.map(t => (
                        <tr key={t.request_id}>
                          <td>{t.request_id}</td>
                          <td>{t.user_id}</td>
                          <td>{t.coins}</td>
                          <td>{t.amount || '-'}</td>
                          <td>{t.method || '-'}</td>
                          <td>{t.status}</td>
                          <td>{t.created_at ? new Date(t.created_at).toLocaleString() : ''}</td>
                          <td style={{display:'flex',gap:8}}>
                            {t.status === 'pending' ? (
                              <>
                                <button className="btn btn-primary" onClick={()=>handleApproveTopup(t)}>Duyệt</button>
                                <button className="btn btn-ghost" onClick={()=>handleRejectTopup(t)}>Từ chối</button>
                              </>
                            ) : (
                              <span className="small muted">Đã xử lý</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {route === 'books' && (
            <section className="panel">
              <h3>All Books</h3>
              <div style={{marginBottom:12}}>
                <h4>Tạo sách mới</h4>
                <form onSubmit={onCreateBook} style={{display:'grid',gap:8,maxWidth:720}}>
                  <input placeholder="Title" value={bookForm.title} onChange={e=>setBookForm({...bookForm,title:e.target.value})} />
                  <input placeholder="Author" value={bookForm.author} onChange={e=>setBookForm({...bookForm,author:e.target.value})} />
                  <select value={bookForm.genre} onChange={e=>setBookForm({...bookForm,genre:e.target.value})} style={{padding:'8px',border:'1px solid #ddd',borderRadius:'4px'}}>
                    <option value="">-- Chọn thể loại --</option>
                    {genres.map(g => <option key={g.genre_id} value={g.name}>{g.name}</option>)}
                  </select>
                  <textarea placeholder="Description" value={bookForm.description} onChange={e=>setBookForm({...bookForm,description:e.target.value})} />
                  <input type="file" accept="image/*" onChange={e=>setCoverFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)} />
                  <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                    <button type="submit" disabled={isCreatingBook} className={isCreatingBook ? 'btn btn-primary disabled' : 'btn btn-primary'}>{isCreatingBook ? 'Creating...' : 'Create Book'}</button>
                  </div>
                </form>
              </div>
              {loading ? <p>Loading...</p> : (
                <div className="books-grid">
                  {books.map(b => (
                    <div key={b.id} className="book-card">
                      <div className="cover">{b.title ? b.title.charAt(0).toUpperCase() : '📖'}</div>
                      <div className="book-info">
                        <h3>{b.title}</h3>
                        <div className="meta"><span className="small">{b.author || 'Không rõ tác giả'}</span></div>
                        {b.genre && <div style={{background:'#f0e6d2',color:'#8b5e34',padding:'4px 8px',borderRadius:'4px',fontSize:'13px',display:'inline-block',marginTop:6,marginBottom:6}}>🏷️ {b.genre}</div>}
                        {!b.genre && <div style={{color:'#999',fontSize:'13px',fontStyle:'italic',marginTop:6,marginBottom:6}}>Chưa có thể loại</div>}
                        <div className="muted">{b.description || <span className="small muted">(Chưa có mô tả)</span>}</div>
                        <div style={{marginTop:8}} className="small">Chapters: {b.chapters ? b.chapters.length : 0}</div>
                          <div style={{marginTop:8,display:'flex',gap:8,alignItems:'center'}}>
                          <button className="btn btn-edit btn-small" onClick={() => handleEditBook(b)} style={{marginRight:8}}>Edit</button>
                          <button className="btn btn-delete btn-small" onClick={() => handleDeleteBook(b)} style={{marginLeft:0}} disabled={deletingBookId === b.id}>{deletingBookId === b.id ? 'Deleting...' : 'Delete'}</button>
                          <button className="btn btn-secondary btn-small" onClick={()=>openChaptersForBook(b.id)} style={{marginLeft:8}}>Chapters</button>
                          {/* Open button removed - use Chapters button or click title to open */}
                        </div>

                        
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* 'newbook' route removed - creation moved into Books page */}

          {route === 'book' && (
            <section className="panel">
              <h3>Book Detail</h3>
              {selectedBookLoading ? <p>Loading...</p> : selectedBook ? (
                <div>
                  <h2>{selectedBook.title}</h2>
                  <div className="muted">{selectedBook.author}</div>
                  <p>{selectedBook.description}</p>
                  <h4>Chapters</h4>
                  <ol>
                    {(selectedBook.chapters || []).map(ch => (
                      <li key={ch.id} style={{marginBottom:8}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                          <div>
                            <strong>{ch.title}</strong>
                            <div className="small muted">{new Date(ch.created_at || ch.createdAt || '').toLocaleString()}</div>
                          </div>
                          <div style={{display:'flex',gap:8}}>
                            <button className="btn btn-edit btn-small" onClick={()=>handleEditChapter(ch)}>Edit</button>
                            <button className="btn btn-delete btn-small" onClick={()=>handleDeleteChapter(ch)} style={{marginLeft:8}} disabled={deletingChapterId === ch.id}>{deletingChapterId === ch.id ? 'Deleting...' : 'Delete'}</button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <h4>Thêm chương cho sách này</h4>
                  <form onSubmit={async (e)=>{ e.preventDefault(); if(!e.target.title.value||!e.target.content.value) return alert('Title & content required'); await createChapter(selectedBook.id, { title: e.target.title.value, content: e.target.content.value }); const b = await getBookById(selectedBook.id); setSelectedBook(b); alert('Added'); }}>
                    <input name="title" placeholder="Tên chương" />
                    <textarea name="content" placeholder="Nội dung chương" />
                    <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                      <button type="submit" disabled={isCreatingChapter} className={isCreatingChapter ? 'btn btn-primary disabled' : 'btn btn-primary'}>{isCreatingChapter ? 'Adding...' : 'Add Chapter'}</button>
                    </div>
                  </form>
                </div>
              ) : <p>Chưa chọn sách</p>}
            </section>
          )}

          {route === 'chapters' && (
            <section className="panel">
              <h3>Chapters Management</h3>
              {selectedBook ? (
                <div>
                  <h2>{selectedBook.title}</h2>
                  <div className="muted">{selectedBook.author}</div>
                  <p>{selectedBook.description}</p>
                  <h4>Chapters</h4>
                  <ol>
                    {(selectedBook.chapters || []).map(ch => (
                      <li key={ch.id} style={{marginBottom:8}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                          <div>
                            <strong>{ch.title}</strong>
                            <div className="small muted">{new Date(ch.created_at || ch.createdAt || '').toLocaleString()}</div>
                          </div>
                          <div style={{display:'flex',gap:8}}>
                            <button className="btn btn-edit btn-small" onClick={()=>handleEditChapter(ch)}>Edit</button>
                            <button className="btn btn-delete btn-small" onClick={()=>handleDeleteChapter(ch)} style={{marginLeft:8}} disabled={deletingChapterId === ch.id}>{deletingChapterId === ch.id ? 'Deleting...' : 'Delete'}</button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <h4>Add Chapter</h4>
                  <form onSubmit={async (e)=>{ e.preventDefault(); const title = e.target.title.value; const content = e.target.content.value; if(!title||!content) return alert('Title & content required'); await createChapter(selectedBook.id, { title, content }); const b = await getBookById(selectedBook.id); setSelectedBook(b); e.target.title.value=''; e.target.content.value=''; alert('Added'); }}>
                    <input name="title" placeholder="Chapter title" />
                    <textarea name="content" placeholder="Chapter content" />
                    <div style={{display:'flex',justifyContent:'flex-end',marginTop:6}}>
                      <button type="submit" disabled={isCreatingChapter} className={isCreatingChapter ? 'btn btn-primary disabled' : 'btn btn-primary'}>{isCreatingChapter ? 'Adding...' : 'Add Chapter'}</button>
                    </div>
                  </form>
                </div>
              ) : (
                  <div>
                  <p>Select a book to manage chapters.</p>
                  <div style={{display:'grid',gap:8}}>
                    {console.log('[chapters view] Books available:', books) || books.map(b => (
                      <div key={b.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:8,background:'#fffefc',borderRadius:6}}>
                        <div>
                          <div style={{fontWeight:700}}>{b.title || `(Untitled ${b.id})`}</div>
                          <div className="small muted">{b.author || 'Không rõ tác giả'}</div>
                        </div>
                          <div>
                            <button className="btn btn-secondary btn-small" onClick={()=>openChaptersForBook(b.id)}>Manage</button>
                          </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Edit Chapter Modal */}
          {editChapterModal && (
            <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <div style={{background:'#fff',padding:20,borderRadius:8,width:720,maxWidth:'95%'}}>
                <h3>Edit Chapter</h3>
                <div style={{display:'grid',gap:8}}>
                  <input value={editChapterModal.title} onChange={e=>setEditChapterModal({...editChapterModal,title:e.target.value})} />
                  <textarea value={editChapterModal.content} onChange={e=>setEditChapterModal({...editChapterModal,content:e.target.value})} rows={12} />
                  <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:6}}>
                    <button onClick={()=>setEditChapterModal(null)} style={{background:'#eee'}}>Cancel</button>
                    <button onClick={()=>submitEditChapter(editChapterModal)} disabled={savingChapter} className={savingChapter ? 'btn btn-primary disabled' : 'btn btn-primary'}>{savingChapter ? 'Saving...' : 'Save'}</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {route === 'genres' && (
            <section className="panel">
              <h3>Genres / Categories</h3>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
                <div>
                  <h4>Create New Genre</h4>
                  <form onSubmit={async (e)=>{
                    e.preventDefault()
                    if(!genreForm.name) return alert('Name required')
                    const res = await createGenre(genreForm)
                    if(res && res.error) return alert(res.error)
                    setGenreForm({name:'',description:''})
                    load()
                  }}>
                    <input placeholder="Genre name" value={genreForm.name} onChange={e=>setGenreForm({...genreForm,name:e.target.value})} style={{marginBottom:8}} />
                    <textarea placeholder="Description" value={genreForm.description} onChange={e=>setGenreForm({...genreForm,description:e.target.value})} rows={3} />
                    <div style={{display:'flex',justifyContent:'flex-end',marginTop:8}}>
                      <button type="submit" className="btn btn-primary">Create</button>
                    </div>
                  </form>
                </div>
                <div>
                  <h4>Existing Genres</h4>
                  {loading ? <p>Loading...</p> : genres.length === 0 ? <p>No genres</p> : (
                    <div style={{display:'grid',gap:8}}>
                      {genres.map(g=>(
                        <div key={g.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',background:'#fffefc',padding:8,borderRadius:6}}>
                          <div>
                            <div style={{fontWeight:700}}>{g.name}</div>
                            {g.description && <div className="small muted">{g.description}</div>}
                          </div>
                          <div style={{display:'flex',gap:6}}>
                            <button className="btn btn-edit btn-small" onClick={()=>setEditGenreModal({...g})}>Edit</button>
                            <button className="btn btn-delete btn-small" onClick={async()=>{
                              if(!confirm(`Delete genre "${g.name}"?`)) return
                              const res = await deleteGenre(g.id)
                              if(res && res.affectedRows) { alert('Deleted'); load() }
                              else alert('Delete failed')
                            }}>Delete</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {route === 'users' && (
            <section className="panel">
              <h3>Users</h3>
              <div style={{ marginBottom: 12 }}>
                <button onClick={() => setCreateUserModal({ fullname: '', email: '', password: '', role: 'user' })} style={{ background: '#8b5e34', color: '#fff', padding: '6px 10px', borderRadius: 6 }}>Add User</button>
              </div>
              {loading ? <p>Loading...</p> : (
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead>
                    <tr style={{textAlign:'left',borderBottom:'1px solid #eee'}}>
                      <th style={{padding:'8px'}}>ID</th>
                      <th style={{padding:'8px'}}>Name</th>
                      <th style={{padding:'8px'}}>Email</th>
                      <th style={{padding:'8px'}}>Role</th>
                      <th style={{padding:'8px'}}>Created</th>
                      <th style={{padding:'8px'}}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id} style={{borderBottom:'1px solid #f2f2f2'}}>
                        <td style={{padding:8}}>{u.id}</td>
                        <td style={{padding:8}}>{u.fullname}</td>
                        <td style={{padding:8}}>{u.email}</td>
                        <td style={{padding:8}}>{u.role}</td>
                        <td style={{padding:8}}>{new Date(u.created_at).toLocaleString()}</td>
                        <td style={{padding:8,display:'flex',gap:6,flexWrap:'wrap'}}>
                          <button className="btn btn-edit btn-small" onClick={() => handleEditUser(u)}>Edit</button>
                          <button className="btn btn-delete btn-small" onClick={() => handleDeleteUser(u)} style={{opacity: u.role === 'admin' ? 0.7 : 1, cursor: 'pointer'}} title={u.role === 'admin' ? 'Không thể xóa tài khoản admin' : ''} disabled={false}>Delete</button>
                          <button className="btn btn-small" onClick={() => handleAdminTopupUser(u)}>Nạp xu</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}

          {/* Edit Book Modal */}
          {editBookModal && (
            <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <div style={{background:'#fff',padding:20,borderRadius:8,width:520,maxWidth:'95%'}}>
                <h3>Chỉnh sửa sách</h3>
                <div style={{display:'grid',gap:8}}>
                  <input placeholder="Title" value={editBookModal.title} onChange={e=>setEditBookModal({...editBookModal,title:e.target.value})} />
                  <input placeholder="Author" value={editBookModal.author} onChange={e=>setEditBookModal({...editBookModal,author:e.target.value})} />
                  <select value={editBookModal.genre || ''} onChange={e=>setEditBookModal({...editBookModal,genre:e.target.value})} style={{padding:'8px',border:'1px solid #ddd',borderRadius:'4px'}}>
                    <option value="">-- Chọn thể loại --</option>
                    {genres.map(g => <option key={g.genre_id} value={g.name}>{g.name}</option>)}
                  </select>
                  <textarea placeholder="Description" value={editBookModal.description} onChange={e=>setEditBookModal({...editBookModal,description:e.target.value})} />
                  <div>
                    <label style={{display:'block',marginBottom:4,fontSize:14,fontWeight:500}}>Đổi ảnh bìa (tùy chọn)</label>
                    <input type="file" accept="image/*" onChange={e=>setEditBookCoverFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)} />
                  </div>
                  <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:6}}>
                    <button onClick={()=>{setEditBookModal(null);setEditBookCoverFile(null)}} style={{background:'#eee'}}>Hủy</button>
                    <button onClick={()=>submitEditBook({...editBookModal,coverFile:editBookCoverFile})} disabled={savingBook} className={savingBook ? 'btn btn-primary disabled' : 'btn btn-primary'}>{savingBook ? 'Đang lưu...' : 'Lưu'}</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Edit User Modal */}
          {editUserModal && (
            <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <div style={{background:'#fff',padding:20,borderRadius:8,width:420,maxWidth:'95%'}}>
                <h3>Edit User</h3>
                <div style={{display:'grid',gap:8}}>
                  <input value={editUserModal.fullname} onChange={e=>setEditUserModal({...editUserModal,fullname:e.target.value})} />
                  <input value={editUserModal.email} onChange={e=>setEditUserModal({...editUserModal,email:e.target.value})} />
                  <select value={editUserModal.role} onChange={e=>setEditUserModal({...editUserModal,role:e.target.value})}>
                    <option value="user">user</option>
                    <option value="author">author</option>
                    <option value="admin">admin</option>
                  </select>
                  <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:6}}>
                    <button onClick={()=>setEditUserModal(null)} style={{background:'#eee'}}>Cancel</button>
                    <button onClick={()=>submitEditUser(editUserModal)} disabled={editUserModal.role==='admin' && editUserModal.email==='admin@example.com' ? false : false}>Save</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Create User Modal */}
          {createUserModal && (
            <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <div style={{background:'#fff',padding:20,borderRadius:8,width:420,maxWidth:'95%'}}>
                <h3>Create User</h3>
                <div style={{display:'grid',gap:8}}>
                  <input placeholder="Full name" value={createUserModal.fullname} onChange={e=>setCreateUserModal({...createUserModal,fullname:e.target.value})} />
                  <input placeholder="Email" value={createUserModal.email} onChange={e=>setCreateUserModal({...createUserModal,email:e.target.value})} />
                  <input placeholder="Password" type="password" value={createUserModal.password} onChange={e=>setCreateUserModal({...createUserModal,password:e.target.value})} />
                  <select value={createUserModal.role} onChange={e=>setCreateUserModal({...createUserModal,role:e.target.value})}>
                    <option value="user">user</option>
                    <option value="author">author</option>
                  </select>
                  <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:6}}>
                    <button onClick={()=>setCreateUserModal(null)} style={{background:'#eee'}}>Cancel</button>
                    <button onClick={()=>handleCreateUserSubmit(createUserModal)}>Create</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Edit Banner Modal */}
          {editBannerModal && (
            <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <div style={{background:'#fff',padding:20,borderRadius:8,width:520,maxWidth:'95%'}}>
                <h3>Edit Banner</h3>
                <div style={{display:'grid',gap:8}}>
                  <input value={editBannerModal.title || ''} onChange={e=>setEditBannerModal({...editBannerModal,title:e.target.value})} />
                  <input value={editBannerModal.link || ''} onChange={e=>setEditBannerModal({...editBannerModal,link:e.target.value})} />
                  <label>Enabled</label>
                  <select value={editBannerModal.enabled ? '1' : '0'} onChange={e=>setEditBannerModal({...editBannerModal,enabled: e.target.value === '1'})}>
                    <option value="1">Enabled</option>
                    <option value="0">Disabled</option>
                  </select>
                  <label>Replace Image</label>
                  <input type="file" accept="image/*" onChange={e=>setEditBannerModal({...editBannerModal,bannerFile: e.target.files && e.target.files[0] ? e.target.files[0] : null})} />
                  {editBannerModal.bannerFile && (<div style={{marginTop:8}}><img src={URL.createObjectURL(editBannerModal.bannerFile)} alt="preview" style={{maxWidth:240}} /></div>)}
                  <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:6}}>
                    <button onClick={()=>setEditBannerModal(null)} style={{background:'#eee'}}>Cancel</button>
                    <button onClick={()=>handleEditBannerSubmit(editBannerModal)}>Save</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Edit Genre Modal */}
          {editGenreModal && (
            <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <div style={{background:'#fff',padding:20,borderRadius:8,width:420,maxWidth:'95%'}}>
                <h3>Edit Genre</h3>
                <div style={{display:'grid',gap:8}}>
                  <input placeholder="Name" value={editGenreModal.name || ''} onChange={e=>setEditGenreModal({...editGenreModal,name:e.target.value})} />
                  <textarea placeholder="Description" value={editGenreModal.description || ''} onChange={e=>setEditGenreModal({...editGenreModal,description:e.target.value})} rows={3} />
                  <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:6}}>
                    <button onClick={()=>setEditGenreModal(null)} style={{background:'#eee'}}>Cancel</button>
                    <button onClick={async ()=>{
                      const res = await updateGenre(editGenreModal.id, {name: editGenreModal.name, description: editGenreModal.description})
                      if(res && res.error) return alert(res.error)
                      setEditGenreModal(null)
                      load()
                    }}>Save</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
                        
