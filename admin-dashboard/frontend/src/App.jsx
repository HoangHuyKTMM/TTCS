import React, { useEffect, useState } from 'react'
import { fetchBooks, createBook, createChapter, getBookById, updateChapter, deleteChapter, login as apiLogin, fetchUsers, updateBook, deleteBook, updateUser, deleteUser, createUser, fetchBanners, createBanner, updateBanner, deleteBanner, fetchAdsAdmin, createAd, updateAd, deleteAd, fetchStats, fetchGenres, createGenre, updateGenre, deleteGenre, fetchTopupRequests, approveTopupRequest, rejectTopupRequest, adminCreditWallet, fetchPayments, fetchDonations, fetchComments, adminUpdateComment, adminDeleteComment } from './api'
import ModerationPanel from './ModerationPanel'
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

function BookCover({ src, title }) {
  const [error, setError] = useState(false)
  const initial = title ? title.charAt(0).toUpperCase() : 'B'

  if (!src || error) {
    return <div className="cover">{initial}</div>
  }

  return (
    <div className="cover">
      <img
        src={src}
        alt={title || ''}
        referrerPolicy="no-referrer"
        onError={() => setError(true)}
      />
    </div>
  )
}

export default function App() {
  const [token, setTokenState] = useState(getToken())
  const [navOpen, setNavOpen] = useState(false)
  const [books, setBooks] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [route, setRoute] = useState('dashboard') // 'dashboard' | 'books' | 'users' | 'genres' | 'coins' | 'transactions'
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
  const [payments, setPayments] = useState([])
  const [donations, setDonations] = useState([])
  const [transactionsError, setTransactionsError] = useState(null)
  const [comments, setComments] = useState([])
  const [commentsError, setCommentsError] = useState(null)
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentFilters, setCommentFilters] = useState({ status: 'pending', bookId: '', storyTitle: '' })
  const maxStorySuggestions = 8
  const [usersError, setUsersError] = useState(null)
  const [topupsError, setTopupsError] = useState(null)
  // loading / busy states for actions
  const [isCreatingBook, setIsCreatingBook] = useState(false)
  const [isCreatingBanner, setIsCreatingBanner] = useState(false)
  const [ads, setAds] = useState([])
  const [adForm, setAdForm] = useState({ title: '', link: '', placement: 'home', enabled: true })
  const [adFile, setAdFile] = useState(null)
  const [editAdModal, setEditAdModal] = useState(null)
  const [isCreatingAd, setIsCreatingAd] = useState(false)
  const [isCreatingChapter, setIsCreatingChapter] = useState(false)
  const [deletingBookId, setDeletingBookId] = useState(null)
  const [deletingChapterId, setDeletingChapterId] = useState(null)
  const [savingChapter, setSavingChapter] = useState(false)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [savingBook, setSavingBook] = useState(false)
  const [adsError, setAdsError] = useState(null)

  const fmtAmount = (v) => {
    if (v === null || v === undefined || v === '') return '-'
    const num = Number(v)
    if (Number.isNaN(num)) return v
    return new Intl.NumberFormat('vi-VN').format(num)
  }

  const fmtDate = (s) => s ? new Date(s).toLocaleString('vi-VN') : ''

  const fmtRef = (ref) => {
    if (ref === null || ref === undefined || ref === '') return '-'
    if (typeof ref === 'object') {
      return Object.entries(ref).map(([k,v])=>`${k}: ${v}`).join(', ')
    }
    const str = String(ref)
    if (str.toLowerCase() === 'null') return '-'
    try {
      const obj = JSON.parse(str)
      if (obj && typeof obj === 'object') {
        return Object.entries(obj).map(([k,v])=>`${k}: ${v}`).join(', ')
      }
    } catch (e) {}
    return str
  }

  const explainRef = (ref) => {
    const raw = fmtRef(ref)
    if (!raw || raw === '-') return '-'
    const lower = raw.toLowerCase()
    if (lower.startsWith('donation_id')) {
      const num = raw.split(':')[1]?.trim()
      return `Gắn với donate #${num || ''}`.trim()
    }
    if (lower.startsWith('topup#')) {
      const num = raw.replace(/[^0-9]/g,'')
      return `Mã nạp top-up #${num || ''}`.trim()
    }
    if (lower.startsWith('sepay_') || lower.startsWith('sepay')) {
      return `Giao dịch tự động SePay (${raw})`
    }
    if (lower === 'buy-author') return 'Thanh toán mua tác giả'
    if (lower === 'admin-topup') return 'Admin nạp thủ công'
    return raw
  }

  const providerBadge = (p) => {
    const map = {
      donation: { label: 'Ủng hộ', color: '#e879f9' },
      bank: { label: 'Ngân hàng', color: '#38bdf8' },
      sepay: { label: 'SePay (Tự động)', color: '#10b981' },
      bank_auto: { label: 'Ngân hàng (Tự động)', color: '#06b6d4' },
      coin: { label: 'Xu', color: '#22c55e' },
      admin: { label: 'Quản trị', color: '#f97316' }
    }
    return map[p] || { label: p || '-', color: '#a8a29e' }
  }

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
        alert('Không thể tải danh sách chương')
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
        if ((r === 'book' || r === 'chapters') && id) {
          setSelectedBookLoading(true)
          try { const b = await getBookById(id); setSelectedBook(b); setRoute(r) } catch(e){console.error(e)} finally{setSelectedBookLoading(false)}
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
      if ((r === 'book' || r === 'chapters') && id) { (async()=>{ setSelectedBookLoading(true); try{ const b = await getBookById(id); setSelectedBook(b); setRoute(r) } catch(e){console.error(e)} finally{setSelectedBookLoading(false)} })() }
      else setRoute(r)
    }
    return ()=> window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => { if (token) setTokenState(token) }, [])

  useEffect(() => { load() }, [route])

  async function loadAds() {
    try {
      const list = await fetchAdsAdmin()
      if (list && list.error) {
        setAds([])
        setAdsError(list.error || 'Không thể tải danh sách video ads')
      } else {
        setAds(Array.isArray(list) ? list : [])
        setAdsError(null)
      }
    } catch (err) {
      console.error('load ads err', err)
      setAds([])
      setAdsError('Không thể tải danh sách video ads')
    }
  }

  async function onCreateAd(e) {
    if (e && e.preventDefault) e.preventDefault()
    setIsCreatingAd(true)
    try {
      const res = await createAd({ ...adForm, videoFile: adFile })
      if (res && res.error) {
        alert(res.error || 'Tạo quảng cáo thất bại')
      } else {
        setAdForm({ title: '', link: '', placement: 'home', enabled: true })
        setAdFile(null)
        await loadAds()
      }
    } catch (err) {
      console.error('create ad err', err)
      alert('Không thể tạo quảng cáo video')
    } finally {
      setIsCreatingAd(false)
    }
  }

  async function handleDeleteAd(a) {
    if (!a) return
    if (!confirm(`Xóa quảng cáo ${a.id}?`)) return
    try {
      const res = await deleteAd(a.id)
      if (res && res.error) alert(res.error || 'Xóa thất bại')
      await loadAds()
    } catch (err) {
      console.error('delete ad err', err)
      alert('Không thể xóa quảng cáo')
    }
  }

  async function handleEditAdSubmit(payload) {
    try {
      const res = await updateAd(payload.id, { ...payload, videoFile: payload.videoFile || null })
      if (res && res.error) {
        alert(res.error || 'Cập nhật thất bại')
        return
      }
      setEditAdModal(null)
      await loadAds()
    } catch (err) {
      console.error('update ad err', err)
      alert('Không thể cập nhật quảng cáo')
    }
  }

  useEffect(() => {
    if (route === 'book' && selectedBook && selectedBook.id) {
      // nothing - already loaded
    }
  }, [route, selectedBook?.id])

  async function load() {
    setLoading(true)
    setLoadError(null)
    setUsersError(null)
    setTopupsError(null)
    setCommentsError(null)
    setAdsError(null)
    try {
      const b = await fetchBooks()
      setBooks(b)
      console.log('[load] Books fetched:', b)
      if (route === 'banners') {
        const bs = await fetchBanners()
        setBanners(Array.isArray(bs) ? bs : [])
      }
      if (route === 'ads') {
        const list = await fetchAdsAdmin()
        if (list && list.error) {
          setAds([])
          setAdsError(list.error || 'Không thể tải danh sách video ads')
        } else {
          setAds(Array.isArray(list) ? list : [])
        }
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
      if (route === 'transactions') {
        try {
          const [p, d] = await Promise.all([fetchPayments(), fetchDonations()])
          setPayments(Array.isArray(p) ? p : [])
          setDonations(Array.isArray(d) ? d : [])
          setTransactionsError(null)
        } catch (e) {
          setTransactionsError('Không thể tải giao dịch')
        }
      }
      if (route === 'comments') {
        await loadComments()
      }
      if (route === 'users') {
        if (!token) {
          setUsers([])
          setUsersError('Bạn cần đăng nhập bằng tài khoản admin để xem danh sách người dùng.')
        } else {
          const u = await fetchUsers()
          if (u && (u.error === 'unauthorized' || u.status === 401 || u.status === 403)) {
            handleUnauthorized(u)
            setUsers([])
            setUsersError('Phiên đăng nhập hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.')
          } else if (u && u.error) {
            setUsers([])
            setUsersError(u.error || u.message || 'Không thể tải danh sách người dùng')
          } else if (Array.isArray(u)) {
            setUsers(u)
          } else if (u && Array.isArray(u.data)) {
            setUsers(u.data)
          } else {
            setUsers([])
            setUsersError('Phản hồi không hợp lệ từ máy chủ người dùng')
          }
        }
      }
      if (route === 'coins') {
        if (!token) {
          setTopups([])
          setTopupsError('Bạn cần đăng nhập để xem yêu cầu nạp xu.')
        } else {
          const t = await fetchTopupRequests()
          if (t && (t.error === 'unauthorized' || t.status === 401 || t.status === 403)) {
            handleUnauthorized(t)
            setTopups([])
            setTopupsError('Phiên đăng nhập hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.')
          } else if (t && t.error) {
            setTopups([])
            setTopupsError(t.error || t.message || 'Không thể tải yêu cầu nạp xu')
          } else if (Array.isArray(t)) {
            setTopups(t)
          } else if (t && Array.isArray(t.data)) {
            setTopups(t.data)
          } else {
            setTopups([])
            setTopupsError('Phản hồi không hợp lệ từ máy chủ top-up')
          }
        }
      }
    } catch (err) {
      console.error(err)
      setLoadError('Không thể kết nối tới server')
    } finally {
      setLoading(false)
    }
  }

  async function reloadTopups() {
    try {
      setTopupsError(null)
      const t = await fetchTopupRequests()
      if (t && (t.error === 'unauthorized' || t.status === 401 || t.status === 403)) {
        handleUnauthorized(t)
        setTopups([])
        setTopupsError('Phiên đăng nhập hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.')
      } else if (t && t.error) {
        setTopups([])
        setTopupsError(t.error || t.message || 'Không thể tải yêu cầu nạp xu')
      } else if (Array.isArray(t)) {
        setTopups(t)
      } else if (t && Array.isArray(t.data)) {
        setTopups(t.data)
      } else {
        setTopups([])
        setTopupsError('Phản hồi không hợp lệ từ máy chủ top-up')
      }
    } catch (err) {
      console.error('reloadTopups err', err)
      setTopupsError('Không thể tải yêu cầu nạp xu')
    }
  }

  async function loadComments(overrides = {}) {
    try {
      setCommentsLoading(true)
      setCommentsError(null)
      const filters = { ...commentFilters, ...overrides }
      // Resolve story title to bookId if provided
      let resolvedBookId = filters.bookId
      const title = (filters.storyTitle || '').trim().toLowerCase()
      if (!resolvedBookId && title) {
        const match = books.find(b => (b.title || '').trim().toLowerCase() === title)
        if (!match) {
          setComments([])
          setCommentsError('Không tìm thấy truyện khớp tên này.')
          return
        }
        resolvedBookId = match.id
      }
      const commentQuery = { bookId: resolvedBookId || undefined, limit: 300 }
      const res = filters.status === 'pending'
        ? await (async () => {
          const [pending, shadow] = await Promise.all([
            fetchComments({ ...commentQuery, status: 'pending' }),
            fetchComments({ ...commentQuery, status: 'shadowbanned' }),
          ])
          if ((pending && pending.error) || (shadow && shadow.error)) {
            return { error: (pending && pending.error) || (shadow && shadow.error) }
          }
          const rows = [].concat(Array.isArray(pending) ? pending : [], Array.isArray(shadow) ? shadow : [])
          const seen = new Set()
          const merged = []
          for (const row of rows) {
            const id = String(row && (row.id || row.comment_id) || '')
            if (id && seen.has(id)) continue
            if (id) seen.add(id)
            merged.push(row)
          }
          merged.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
          return merged
        })()
        : await fetchComments({ ...commentQuery, status: filters.status || undefined })
      if (res && res.error) {
        setComments([])
        setCommentsError(res.error || 'Không thể tải bình luận')
      } else if (Array.isArray(res)) {
        setComments(res)
      } else {
        setComments([])
        setCommentsError('Phản hồi không hợp lệ từ server bình luận')
      }
    } catch (err) {
      console.error('loadComments err', err)
      setCommentsError('Không thể tải bình luận')
      setComments([])
    } finally {
      setCommentsLoading(false)
    }
  }

  const storySuggestions = (() => {
    const q = (commentFilters.storyTitle || '').trim().toLowerCase()
    if (!q) return []
    return books
      .filter(b => (b.title || '').toLowerCase().includes(q))
      .slice(0, maxStorySuggestions)
  })()

  async function handleApproveComment(c) {
    try {
      const res = await adminUpdateComment(c.id, { status: 'approved' })
      if (res && res.error) return alert(res.error || 'Không thể duyệt')
      await loadComments()
    } catch (err) {
      console.error('approve comment err', err)
      alert('Không thể duyệt bình luận')
    }
  }

  async function handleRejectComment(c) {
    try {
      const res = await adminUpdateComment(c.id, { status: 'rejected' })
      if (res && res.error) return alert(res.error || 'Không thể từ chối')
      await loadComments()
    } catch (err) {
      console.error('reject comment err', err)
      alert('Không thể từ chối bình luận')
    }
  }

  async function handleDeleteComment(c) {
    if (!confirm('Gỡ bình luận này?')) return
    try {
      const res = await adminDeleteComment(c.id)
      if (res && res.error) return alert(res.error || 'Không thể gỡ')
      await loadComments()
    } catch (err) {
      console.error('delete comment err', err)
      alert('Không thể gỡ bình luận')
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
    if (!bookForm.title) return alert('Tiêu đề là bắt buộc')
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
    if (!bannerForm.title) return alert('Tiêu đề là bắt buộc')
    const payload = { ...bannerForm }
    if (bannerFile) payload.bannerFile = bannerFile
    setIsCreatingBanner(true)
    try {
      const res = await createBanner(payload)
      if (res && res.id) {
        alert('Tạo banner thành công')
        setBannerForm({ title: '', link: '', enabled: true })
        setBannerFile(null)
        loadBanners()
      } else {
        alert(res.error || 'Tạo banner thất bại')
      }
    } catch (err) {
      console.error('createBanner err', err)
      alert('Tạo banner thất bại')
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
        alert('Cập nhật banner thành công')
        setEditBannerModal(null)
        loadBanners()
      } else {
        alert(res.error || 'Cập nhật banner thất bại')
      }
    } catch (err) {
      console.error('updateBanner err', err)
      alert('Cập nhật banner thất bại')
    }
  }

  async function handleDeleteBanner(b) {
    if (!confirm(`Xóa banner "${b.title}"?`)) return
    const res = await deleteBanner(b.id)
    if (res && (res.affectedRows !== undefined ? res.affectedRows > 0 : true)) {
      alert('Đã xóa')
      loadBanners()
    } else {
      alert(res.error || 'Xóa thất bại')
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
        alert(res.error || 'Đăng nhập thất bại')
      }
    } catch (err) {
      console.error(err)
      alert('Lỗi đăng nhập')
    } finally {
      setIsLoggingIn(false)
    }
  }

  function handleLogout() {
    removeToken()
    setTokenState(null)
  }

  function handleUnauthorized(reason) {
    console.warn('Auth expired or invalid token', reason)
    removeToken()
    setTokenState(null)
  }

  async function onCreateChapter(e) {
    e.preventDefault()
    if (!chapterForm.bookId) return alert('Vui lòng chọn sách')
    if (!chapterForm.title || !chapterForm.content) return alert('Cần nhập tiêu đề và nội dung')
    setIsCreatingChapter(true)
    try {
      await createChapter(chapterForm.bookId, { title: chapterForm.title, content: chapterForm.content })
      setChapterForm({ bookId: '', title: '', content: '' })
      load()
    } catch (err) {
      console.error('createChapter err', err)
      alert(err && err.message ? err.message : 'Tạo chương thất bại')
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
    if (!selectedBook || !selectedBook.id) return alert('Chưa chọn sách')
    try {
      setSavingChapter(true)
      await updateChapter(selectedBook.id, payload.id, { title: payload.title, content: payload.content })
      // refresh book
      const b = await getBookById(selectedBook.id)
      setSelectedBook(b)
      setEditChapterModal(null)
      alert('Đã cập nhật chương')
    } catch (err) {
      console.error('update chapter err', err)
      alert(err && err.message ? err.message : 'Không thể cập nhật chương')
    } finally {
      setSavingChapter(false)
    }
  }

  async function handleDeleteChapter(ch) {
    if (!selectedBook || !selectedBook.id) return alert('Chưa chọn sách')
    if (!confirm(`Xóa chương "${ch.title}"? Hành động này không thể hoàn tác.`)) return
    try {
      setDeletingChapterId(ch.id)
      await deleteChapter(selectedBook.id, ch.id)
      const b = await getBookById(selectedBook.id)
      setSelectedBook(b)
      alert('Đã xóa')
    } catch (err) {
      console.error('delete chapter err', err)
      alert(err && err.message ? err.message : 'Xóa thất bại')
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
    if (!confirm(`Xóa người dùng ${u.email}? Hành động này không thể hoàn tác.`)) return
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

  const chapterCount = books.reduce((sum, book) => sum + (book.chapters ? book.chapters.length : 0), 0)
  const incomeLabel = typeof stats.income === 'number'
    ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(stats.income)
    : (stats.income ? String(stats.income) : '0 ₫')
  const pages = {
    dashboard: ['Tổng quan', 'Top truyện, người dùng và doanh thu'],
    books: ['Sách', 'Tạo tác phẩm, ảnh bìa và lưới thư viện'],
    book: ['Chi tiết sách', selectedBook?.title || 'Một tác phẩm'],
    chapters: ['Chương', selectedBook ? selectedBook.title : 'Chọn một sách để soạn'],
    banners: ['Banner', 'Form bên trái, danh sách và xem trước bên phải'],
    ads: ['Quảng cáo video', 'Tải mp4, chọn vị trí, bật hoặc tắt'],
    genres: ['Thể loại', 'Tên, mô tả, sửa hoặc xóa'],
    users: ['Người dùng', 'Vai trò, số xu, thêm và nạp'],
    transactions: ['Giao dịch', 'Sổ thanh toán và bảng ủng hộ'],
    comments: ['Bình luận', 'Lọc trạng thái, rút gọn nội dung, gỡ'],
    integrity: ['Kiểm duyệt AI', 'Hàng chờ, diff hai cột, xuất bản hoặc khóa']
  }
  const page = pages[route] || ['Bảng điều khiển', '']
  const go = (event, to) => {
    event.preventDefault()
    setNavOpen(false)
    navigate(to)
  }
  const roleLabel = { user: 'Người dùng', author: 'Tác giả', admin: 'Quản trị' }

  return (
    <div className="site">
      <div className="container">
        {navOpen ? <button className="scrim" aria-label="Đóng menu" onClick={() => setNavOpen(false)} /> : null}
        <aside className={navOpen ? 'sidebar open' : 'sidebar'}>
          <div className="brand">
            <div className="brand-mark">R</div>
            <div>
              <div className="logo">Reader Admin</div>
              <div className="muted">Công cụ nội bộ</div>
            </div>
          </div>
          <div className="nav-label">Nội dung</div>
          <nav className="nav">
            <a href="#dashboard" onClick={e => go(e, 'dashboard')} className={route === 'dashboard' ? 'active' : ''}>Tổng quan</a>
            <a href="#books" onClick={e => go(e, 'books')} className={route === 'books' || route === 'book' ? 'active' : ''}>Sách</a>
            <a href="#chapters" onClick={e => go(e, 'chapters')} className={route === 'chapters' ? 'active' : ''}>Chương</a>
            <a href="#genres" onClick={e => go(e, 'genres')} className={route === 'genres' ? 'active' : ''}>Thể loại</a>
            <a href="#banners" onClick={e => go(e, 'banners')} className={route === 'banners' ? 'active' : ''}>Banner</a>
            <a href="#ads" onClick={e => go(e, 'ads')} className={route === 'ads' ? 'active' : ''}>Quảng cáo video</a>
          </nav>
          <div className="nav-label">Vận hành</div>
          <nav className="nav">
            <a href="#users" onClick={e => go(e, 'users')} className={route === 'users' ? 'active' : ''}>Người dùng</a>
            <a href="#transactions" onClick={e => go(e, 'transactions')} className={route === 'transactions' ? 'active' : ''}>Giao dịch</a>
            <a href="#comments" onClick={e => go(e, 'comments')} className={route === 'comments' ? 'active' : ''}>Bình luận</a>
            <a href="#integrity" onClick={e => go(e, 'integrity')} className={route === 'integrity' ? 'active' : ''}>Kiểm duyệt AI</a>
          </nav>
          {!token && (
            <div className="sidebar-foot">
              <a href="/login.html">Đăng nhập</a>
              <a href="/register.html">Đăng ký admin</a>
            </div>
          )}
        </aside>

        <main className="main">
          <header className="topbar">
            <div>
              <button className="btn btn-ghost nav-toggle" onClick={() => setNavOpen(true)}>Menu</button>
              <div className="eyebrow">{page[1]}</div>
              <h1>{page[0]}</h1>
            </div>
            <div className="top-stats">
              <span className="stat-pill"><b>{books.length}</b> sách</span>
              <span className="stat-pill"><b>{chapterCount}</b> chương</span>
              <span className="stat-pill"><b>{incomeLabel}</b> doanh thu</span>
              {token ? <button className="btn btn-ghost" onClick={handleLogout}>Đăng xuất</button> : null}
            </div>
          </header>
          {loadError ? <div className="alert error">{loadError}</div> : null}

          {route === 'dashboard' && (
            <>
              <section className="panel">
                <h3>Chỉ số</h3>
                <div className="kpi-grid">
                  <div className="rank-card">
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}>
                      <strong>Top truyện</strong>
                      <span className="small">Theo lượt xem</span>
                    </div>
                    {stats.top_books && stats.top_books.length > 0 ? stats.top_books.map((book, idx) => (
                      <div className="rank-row" key={book.id}>
                        <div>
                          <span className="rank-index">{idx + 1}</span>
                          {book.title}
                        </div>
                        <div style={{display:'flex',gap:14}}>
                          <div className="metric"><span className="small">Xem</span><b>{fmtAmount(book.views || 0)}</b></div>
                          <div className="metric"><span className="small">Thích</span><b>{fmtAmount(book.likes || 0)}</b></div>
                        </div>
                      </div>
                    )) : <div className="empty">Chưa có dữ liệu truyện</div>}
                  </div>
                  <div className="kpi">
                    <div className="kpi-row">
                      <div><div className="kpi-label">Mới hôm nay</div><b>{stats.new_users_today || 0}</b></div>
                      <div><div className="kpi-label">7 ngày</div><b>{stats.new_users_7d || 0}</b></div>
                    </div>
                    <div className="kpi-row">
                      <div><div className="kpi-label">Hoạt động 24 giờ</div><b>{stats.active_users_24h || 0}</b></div>
                      <div><div className="kpi-label">15 phút</div><b>{stats.active_users_15m || 0}</b></div>
                    </div>
                    <div className="kpi-row">
                      <div><div className="kpi-label">VIP</div><b>{stats.vip_users || 0}</b></div>
                      <div><div className="kpi-label">Tác giả</div><b>{stats.authors || 0}</b></div>
                    </div>
                  </div>
                  <div className="kpi">
                    <div className="kpi-label">Doanh thu</div>
                    <div className="kpi-value">{incomeLabel}</div>
                    <div className="kpi-sub">Tổng từ bảng thanh toán</div>
                    <div className="kpi-row">
                      <div>
                        <div className="kpi-label">Tháng này</div>
                        <b>{typeof stats.income_this_month === 'number' ? new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(stats.income_this_month) : (stats.income_this_month || '0')}</b>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
              {/* Quick links and quick actions moved into Books page */}

              <section className="panel">
                <h3>Sách mới nhất</h3>
                {loading ? <p>Đang tải...</p> : (
                  <div className="books-grid" style={{maxHeight:'600px', overflowY:'auto', paddingRight:'8px'}}>
                    {books.map(b => (
                      <div key={b.id} className="book-card">
                        <BookCover src={b.cover_url} title={b.title} />
                        <div className="book-info">
                          <h3 style={{cursor:'pointer'}} onClick={()=>openBook(b.id)}>{b.title}</h3>
                          <div className="meta"><span className="small">{b.author || 'Không rõ tác giả'}</span></div>
                          <div style={{marginTop:8}} className="small">Số chương: {b.chapters ? b.chapters.length : (b.chapters_count || 0)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

          {route === 'integrity' && (
            <section className="panel">
              <ModerationPanel />
            </section>
          )}

          {route === 'comments' && (
            <section className="panel">
              <h3>Quản lý bình luận</h3>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                <div>
                  <label className="small muted">Trạng thái</label>
                  <select value={commentFilters.status} onChange={(e)=>{ const v=e.target.value; const next={...commentFilters,status:v}; setCommentFilters(next); loadComments(next); }}>
                    <option value="">Tất cả</option>
                    <option value="pending">Chờ duyệt</option>
                    <option value="shadowbanned">Ẩn (vàng)</option>
                    <option value="approved">Đã duyệt</option>
                    <option value="rejected">Từ chối</option>
                  </select>
                </div>
                <div>
                  <label className="small muted">Tên truyện</label>
                  <div style={{ position:'relative' }}>
                    <input
                      value={commentFilters.storyTitle}
                      placeholder="Nhập tên truyện"
                      onChange={(e)=>{ const next={...commentFilters, storyTitle: e.target.value, bookId: ''}; setCommentFilters(next); }}
                      onKeyDown={(e)=>{ if (e.key === 'Enter') loadComments(); }}
                      onBlur={()=>setTimeout(()=>loadComments(), 150)}
                    />
                    {storySuggestions.length > 0 && (
                      <div style={{ position:'absolute', top:'100%', left:0, right:0, background:'#fff', border:'1px solid var(--line)', zIndex:10, maxHeight:220, overflowY:'auto', borderRadius:8, boxShadow:'var(--shadow)' }}>
                        {storySuggestions.map(s => (
                          <div
                            key={s.id}
                            style={{ padding:'8px 12px', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center' }}
                            className="suggest-item"
                            onMouseDown={(e)=>e.preventDefault()}
                            onClick={()=>{
                              const next = { ...commentFilters, storyTitle: s.title || '', bookId: s.id }
                              setCommentFilters(next)
                              loadComments(next)
                            }}
                          >
                            <span>{s.title}</span>
                            <span className="small muted">#{s.id}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display:'flex', alignItems:'flex-end', gap:8 }}>
                  <button className="btn btn-primary" onClick={()=>loadComments()} disabled={commentsLoading}>{commentsLoading ? 'Đang tải...' : 'Tải lại'}</button>
                </div>
                <div style={{ display:'flex', alignItems:'flex-end', gap:8 }}>
                  <div className="muted small">Tổng: {comments.length}</div>
                </div>
              </div>

              {commentsError && (<div className="alert error">{commentsError}</div>)}

              <div className="table" style={{ overflowX:'auto', maxHeight:'600px', overflowY:'auto' }}>
                <table style={{ tableLayout:'auto', width:'100%', minWidth:0, borderCollapse:'separate', borderSpacing:0 }}>
                  <thead style={{position:'sticky', top:0, zIndex:1}}>
                    <tr>
                      <th style={{whiteSpace:'nowrap', padding:'8px 10px', textAlign:'left'}}>ID</th>
                      <th style={{padding:'8px 10px', textAlign:'left'}}>Truyện</th>
                      <th style={{padding:'8px 10px', textAlign:'left'}}>Người dùng</th>
                      <th style={{padding:'8px 10px', textAlign:'left'}}>Nội dung</th>
                      <th style={{whiteSpace:'nowrap', padding:'8px 10px', textAlign:'left'}}>Ngày</th>
                      <th style={{textAlign:'center', whiteSpace:'nowrap', padding:'8px 10px'}}>Hành động</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comments.length === 0 && (
                      <tr><td colSpan={7} style={{ textAlign:'center', padding:12 }} className="muted">Không có bình luận</td></tr>
                    )}
                    {comments.map(c => (
                      <tr key={c.id}>
                        <td className="small muted" style={{verticalAlign:'top', padding:'12px'}}>{c.id}</td>
                        <td className="small" style={{verticalAlign:'top', wordBreak:'break-word', padding:'12px'}}>
                          <div style={{fontWeight:700, lineHeight:1.4}}>{c.story_title || c.story_name || c.story || c.story_id}</div>
                          {(c.story_id && (c.story_title || c.story_name)) && <div className="small muted">#{c.story_id}</div>}
                        </td>
                        <td className="small" style={{verticalAlign:'top', wordBreak:'break-word', padding:'12px'}}>{c.user_name || c.user_id || '—'}</td>
                        <td style={{verticalAlign:'top', padding:'12px'}}><div className="clamp">{c.content}</div></td>
                        <td className="small muted" style={{verticalAlign:'top', padding:'12px', whiteSpace:'nowrap'}}>{c.created_at ? new Date(c.created_at).toLocaleString('vi-VN') : ''}</td>
                        <td style={{ textAlign:'center', verticalAlign:'top', padding:'12px' }}>
                          <button className="btn btn-small" style={{background:'#ef4444', minWidth:72}} onClick={()=>handleDeleteComment(c)}>Gỡ</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {route === 'banners' && (
            <section className="panel">
              <h3>Banner</h3>
              <div className="split">
                <div>
                  <form onSubmit={onCreateBanner}>
                    <label>Tiêu đề</label>
                    <input value={bannerForm.title} onChange={e=>setBannerForm({...bannerForm,title:e.target.value})} />
                    <label>Liên kết</label>
                    <input value={bannerForm.link} onChange={e=>setBannerForm({...bannerForm,link:e.target.value})} placeholder="https://..." />
                    <label>Trạng thái</label>
                    <select value={bannerForm.enabled ? '1' : '0'} onChange={e=>setBannerForm({...bannerForm,enabled: e.target.value === '1'})}>
                      <option value="1">Bật</option>
                      <option value="0">Tắt</option>
                    </select>
                    <label>Hình ảnh</label>
                    <input type="file" accept="image/*" onChange={e=>setBannerFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)} />
                    {bannerFile && (<div style={{marginTop:8}}><img src={URL.createObjectURL(bannerFile)} alt="xem trước" style={{maxWidth:240}} /></div>)}
                    <div style={{display:'flex',justifyContent:'flex-end'}}>
                      <button type="submit" disabled={isCreatingBanner} className={isCreatingBanner ? 'btn btn-primary disabled' : 'btn btn-primary'}>{isCreatingBanner ? 'Đang tạo...' : 'Tạo banner'}</button>
                    </div>
                  </form>
                </div>
                <div>
                  <h4>Banner hiện có</h4>
                  {banners.length === 0 ? <p>Chưa có banner</p> : (
                    <div style={{display:'grid',gap:12}}>
                      {banners.map(b => (
                        <div className="media-row" key={b.id}>
                          <div className="thumb">
                            {b.image_url ? <img src={b.image_url} alt={b.title} /> : 'Chưa có hình'}
                          </div>
                          <div style={{flex:1}}>
                            <div style={{fontWeight:700}}>{b.title}</div>
                            <div className="small muted">{b.link}</div>
                          </div>
                          <div style={{display:'flex',flexDirection:'column',gap:6}}>
                            <button className="btn btn-edit btn-small" onClick={()=>setEditBannerModal({...b, bannerFile: null})}>Sửa</button>
                            <button onClick={()=>handleDeleteBanner(b)} style={{background:'#ff6b6b'}} disabled={false}>Xóa</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {route === 'ads' && (
            <section className="panel">
              <h3>Quảng cáo video</h3>
              <div className="muted" style={{ marginBottom: 10 }}>
                Upload video ngắn (mp4) và bật/tắt theo nhu cầu. Ứng dụng sẽ lấy danh sách từ API <code>/ads</code>.
              </div>

              {adsError ? (
                <div className="alert error" style={{ marginBottom: 12 }}>
                  {adsError}
                </div>
              ) : null}

              <div className="split">
                <div>
                  <form onSubmit={onCreateAd}>
                    <label>Tiêu đề</label>
                    <input value={adForm.title} onChange={e=>setAdForm({...adForm,title:e.target.value})} />
                    <label>Liên kết (tùy chọn)</label>
                    <input value={adForm.link} onChange={e=>setAdForm({...adForm,link:e.target.value})} placeholder="https://..." />
                    <label>Vị trí hiển thị</label>
                    <select value={adForm.placement} onChange={e=>setAdForm({...adForm,placement:e.target.value})}>
                      <option value="home">Trang chủ</option>
                      <option value="book-open">Khi mở truyện</option>
                      <option value="reader">Khi đọc</option>
                    </select>
                    <label>Trạng thái</label>
                    <select value={adForm.enabled ? '1' : '0'} onChange={e=>setAdForm({...adForm,enabled: e.target.value === '1'})}>
                      <option value="1">Bật</option>
                      <option value="0">Tắt</option>
                    </select>
                    <label>Video</label>
                    <input type="file" accept="video/*" onChange={e=>setAdFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)} />
                    {adFile && (
                      <div style={{ marginTop: 8 }}>
                        <video src={URL.createObjectURL(adFile)} controls style={{ maxWidth: '100%', borderRadius: 8 }} />
                      </div>
                    )}
                    <div style={{display:'flex',justifyContent:'flex-end'}}>
                      <button type="submit" disabled={isCreatingAd} className={isCreatingAd ? 'btn btn-primary disabled' : 'btn btn-primary'}>
                        {isCreatingAd ? 'Đang tạo...' : 'Tạo quảng cáo video'}
                      </button>
                    </div>
                  </form>
                </div>

                <div>
                  <h4>Video ads hiện có</h4>
                  {ads.length === 0 ? <p>Chưa có quảng cáo</p> : (
                    <div style={{display:'grid',gap:12}}>
                      {ads.map(a => (
                        <div className="media-row" key={a.id}>
                          <div className="thumb video">
                            {a.video_url ? (
                              <video src={a.video_url} muted />
                            ) : 'Chưa có video'}
                          </div>
                          <div style={{flex:1}}>
                            <div style={{fontWeight:700}}>{a.title || '(chưa có tiêu đề)'}</div>
                            <div className="small muted">vị trí: {a.placement || 'interstitial'} • {a.enabled ? 'đang bật' : 'đang tắt'}</div>
                            <div className="small muted" style={{wordBreak:'break-all'}}>{a.link || ''}</div>
                          </div>
                          <div style={{display:'flex',flexDirection:'column',gap:6}}>
                            <button className="btn btn-edit btn-small" onClick={()=>setEditAdModal({ ...a, videoFile: null })}>Sửa</button>
                            <button onClick={()=>handleDeleteAd(a)} style={{background:'#ff6b6b'}} disabled={false}>Xóa</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}



          {route === 'transactions' && (
            <section className="panel">
              <h3>Giao dịch</h3>
              {transactionsError ? (
                <div className="alert error">{transactionsError}</div>
              ) : (
                <div style={{display:'grid', gap:16}}>
                  <div>
                    <h4>Thanh toán (mua VIP / nạp xu)</h4>
                    {(() => {
                      const filteredPayments = payments.filter(p => {
                        const coinsNum = Number(p.coins)
                        const amountNum = Number(p.amount)
                        const hasVipDuration = (p.months && Number(p.months) > 0) || (p.days && Number(p.days) > 0)
                        const hasCoins = !Number.isNaN(coinsNum) && coinsNum > 0
                        const hasAmount = !Number.isNaN(amountNum) && amountNum > 0
                        return hasVipDuration || hasCoins || hasAmount
                      })
                      if (filteredPayments.length === 0) return <div className="muted" style={{padding:8}}>Chưa có giao dịch.</div>
                      return (
                      <div style={{overflowX:'auto', maxHeight:'500px', overflowY:'auto'}}>
                        <table className="table" style={{minWidth:1024}}>
                          <thead style={{position:'sticky', top:0, zIndex:1, background:'var(--surface-header, #f8fafc)'}}>
                            <tr>
                              <th style={{width:72}}>ID</th>
                              <th style={{width:200}}>Người dùng</th>
                              <th style={{width:140}}>Số tiền</th>
                              <th style={{width:130}}>Xu</th>
                              <th style={{width:130}}>Phương thức</th>
                              <th style={{width:220}}>Tham chiếu (mã giao dịch / ghi chú)</th>
                              <th style={{width:140}}>Thời hạn</th>
                              <th style={{width:180}}>Ngày tạo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredPayments.map(p => {
                              const prov = providerBadge(p.provider)
                              const ref = fmtRef(p.provider_ref)
                              const duration = p.months ? `${p.months} tháng` : p.days ? `${p.days} ngày` : '-'
                              return (
                                <tr key={p.payment_id || p.id}>
                                  <td style={{whiteSpace:'nowrap'}}>{p.payment_id || p.id}</td>
                                  <td>
                                      <div style={{fontWeight:600}}>{p.fullname || p.email || p.user_id}</div>
                                      {p.email && <div className="small muted">{p.email}</div>}
                                    </td>
                                    <td style={{fontWeight:700,whiteSpace:'nowrap'}}>{fmtAmount(p.amount)}</td>
                                    <td style={{fontWeight:700,whiteSpace:'nowrap'}}>{p.coins !== undefined && p.coins !== null ? fmtAmount(p.coins) : '-'}</td>
                                    <td>
                                      <span style={{background:prov.color,color:'#0b0b0b',padding:'2px 10px',borderRadius:999,fontSize:12,fontWeight:700}}>{prov.label}</span>
                                    </td>
                                    <td style={{maxWidth:320,wordBreak:'break-word',lineHeight:1.4}}>
                                      <div style={{fontWeight:600}}>{explainRef(p.provider_ref)}</div>
                                      {ref && ref !== explainRef(p.provider_ref) && <div className="small muted">{ref}</div>}
                                    </td>
                                    <td style={{whiteSpace:'nowrap'}}>{duration}</td>
                                    <td style={{whiteSpace:'nowrap'}}>{fmtDate(p.created_at)}</td>
                                  </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )})()}
                  </div>

                  <div>
                    <h4>Ủng hộ (người dùng → tác giả)</h4>
                    {donations.length === 0 ? <div className="muted" style={{padding:8}}>Chưa có ủng hộ.</div> : (
                      <div style={{overflowX:'auto', maxHeight:'500px', overflowY:'auto'}}>
                        <table className="table" style={{minWidth:1100}}>
                          <thead style={{position:'sticky', top:0, zIndex:1, background:'var(--surface-header, #f8fafc)'}}>
                            <tr>
                              <th style={{width:72}}>ID</th>
                              <th style={{width:200}}>Người tặng</th>
                              <th style={{width:200}}>Tác giả</th>
                              <th style={{width:90}}>Truyện</th>
                              <th style={{width:180}}>Quà</th>
                              <th style={{width:120}}>Xu</th>
                              <th style={{width:260}}>Lời nhắn</th>
                              <th style={{width:180}}>Thời gian</th>
                            </tr>
                          </thead>
                          <tbody>
                            {donations.map(d => (
                              <tr key={d.donation_id || d.id}>
                                <td style={{whiteSpace:'nowrap'}}>{d.donation_id || d.id}</td>
                                <td>
                                  <div style={{fontWeight:600}}>{d.donor_name || d.donor_email || d.donor_id}</div>
                                  {d.donor_email && <div className="small muted">{d.donor_email}</div>}
                                </td>
                                <td>
                                  <div style={{fontWeight:600}}>{d.author_display || d.author_name || d.author_pen_name || d.author_email || d.author_id}</div>
                                  {(d.author_email || d.author_user_id) && <div className="small muted">{d.author_email || d.author_user_id}</div>}
                                </td>
                                <td style={{whiteSpace:'nowrap'}}>{d.story_title || d.story_name || d.story || d.story_id}</td>
                                <td style={{whiteSpace:'nowrap'}}>
                                  {d.gift_name
                                    ? `${d.gift_emoji || '🎁'} ${d.gift_name}${Number(d.quantity) > 1 ? ` ×${d.quantity}` : ''}`
                                    : 'Xu trực tiếp'}
                                </td>
                                <td style={{fontWeight:700,whiteSpace:'nowrap'}}>{fmtAmount(d.coins)}</td>
                                <td style={{maxWidth:340,wordBreak:'break-word',lineHeight:1.4}}>{d.message && d.message.trim() ? d.message : '-'}</td>
                                <td style={{whiteSpace:'nowrap'}}>{fmtDate(d.created_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {route === 'books' && (
            <section className="panel">
              <div className="split">
                <div className="composer">
                  <h3>Tạo sách</h3>
                  <form className="stack" onSubmit={onCreateBook}>
                    <input placeholder="Tiêu đề" value={bookForm.title} onChange={e=>setBookForm({...bookForm,title:e.target.value})} />
                    <input placeholder="Tác giả" value={bookForm.author} onChange={e=>setBookForm({...bookForm,author:e.target.value})} />
                    <select value={bookForm.genre} onChange={e=>setBookForm({...bookForm,genre:e.target.value})}>
                      <option value="">Chọn thể loại</option>
                      {genres.map(g => <option key={g.genre_id || g.id} value={g.name}>{g.name}</option>)}
                    </select>
                    <textarea placeholder="Mô tả" value={bookForm.description} onChange={e=>setBookForm({...bookForm,description:e.target.value})} />
                    <input type="file" accept="image/*" onChange={e=>setCoverFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)} />
                    {coverFile ? <img src={URL.createObjectURL(coverFile)} alt="Xem trước ảnh bìa" style={{width:92,height:128,objectFit:'cover',borderRadius:8}} /> : null}
                    <div className="actions">
                      <button type="submit" disabled={isCreatingBook} className={isCreatingBook ? 'btn btn-primary disabled' : 'btn btn-primary'}>{isCreatingBook ? 'Đang tạo...' : 'Tạo sách'}</button>
                    </div>
                  </form>
                </div>
                <div>
                  <h3>Thư viện</h3>
                  {loading ? <p>Đang tải...</p> : books.length === 0 ? <div className="empty">Chưa có sách</div> : (
                    <div className="books-grid">
                      {books.map(b => (
                        <div key={b.id} className="book-card">
                          <BookCover src={b.cover_url} title={b.title} />
                          <div className="book-info">
                            <h3>{b.title}</h3>
                            <div className="meta"><span className="small">{b.author || 'Không rõ tác giả'}</span></div>
                            {b.genre ? <div className="chip">{b.genre}</div> : <div className="small">Chưa có thể loại</div>}
                            <div className="muted clamp">{b.description || 'Chưa có mô tả'}</div>
                            <div className="small" style={{marginTop:8}}>Chương: {b.chapters ? b.chapters.length : (b.chapters_count || 0)}</div>
                            <div className="actions" style={{justifyContent:'flex-start',marginTop:8}}>
                              <button className="btn btn-edit btn-small" onClick={() => handleEditBook(b)}>Sửa</button>
                              <button className="btn btn-delete btn-small" onClick={() => handleDeleteBook(b)} disabled={deletingBookId === b.id}>{deletingBookId === b.id ? 'Đang xóa...' : 'Xóa'}</button>
                              <button className="btn btn-secondary btn-small" onClick={()=>openChaptersForBook(b.id)}>Chương</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* 'newbook' route removed - creation moved into Books page */}

          {route === 'book' && (
            <section className="panel">
              {selectedBookLoading ? <p>Đang tải...</p> : selectedBook ? (
                <div className="editor-split">
                  <div>
                    <h3>{selectedBook.title}</h3>
                    <div className="muted">{selectedBook.author}</div>
                    <p>{selectedBook.description}</p>
                    <div className="chapter-list">
                      {(selectedBook.chapters || []).length === 0 ? <div className="empty">Chưa có chương</div> : (selectedBook.chapters || []).map(ch => (
                        <div className="chapter-row" key={ch.id}>
                          <div>
                            <strong>{ch.title}</strong>
                            <div className="small">{new Date(ch.created_at || ch.createdAt || '').toLocaleString()}</div>
                          </div>
                          <div className="actions">
                            <button className="btn btn-edit btn-small" onClick={()=>handleEditChapter(ch)}>Sửa</button>
                            <button className="btn btn-delete btn-small" onClick={()=>handleDeleteChapter(ch)} disabled={deletingChapterId === ch.id}>{deletingChapterId === ch.id ? 'Đang xóa...' : 'Xóa'}</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <form className="editor stack" onSubmit={async (e)=>{ e.preventDefault(); const form = e.target; if(!form.title.value||!form.content.value) return alert('Cần nhập tiêu đề và nội dung'); try { await createChapter(selectedBook.id, { title: form.title.value, content: form.content.value }); const b = await getBookById(selectedBook.id); setSelectedBook(b); form.reset(); } catch (err) { alert(err && err.message ? err.message : 'Tạo chương thất bại') } }}>
                    <h3>Thêm chương</h3>
                    <input name="title" placeholder="Tiêu đề chương" />
                    <textarea name="content" placeholder="Nội dung chương" />
                    <div className="actions">
                      <button type="submit" disabled={isCreatingChapter} className={isCreatingChapter ? 'btn btn-primary disabled' : 'btn btn-primary'}>{isCreatingChapter ? 'Đang thêm...' : 'Thêm chương'}</button>
                    </div>
                  </form>
                </div>
              ) : <p>Chưa chọn sách</p>}
            </section>
          )}

          {route === 'chapters' && (
            <section className="panel">
              {selectedBook ? (
                <div className="editor-split">
                  <div>
                    <h3>{selectedBook.title}</h3>
                    <div className="muted">{selectedBook.author}</div>
                    <div className="chapter-list">
                      {(selectedBook.chapters || []).length === 0 ? <div className="empty">Chưa có chương</div> : (selectedBook.chapters || []).map(ch => (
                        <div className="chapter-row" key={ch.id}>
                          <div>
                            <strong>{ch.title}</strong>
                            <div className="small">{new Date(ch.created_at || ch.createdAt || '').toLocaleString()}</div>
                          </div>
                          <div className="actions">
                            <button className="btn btn-edit btn-small" onClick={()=>handleEditChapter(ch)}>Sửa</button>
                            <button className="btn btn-delete btn-small" onClick={()=>handleDeleteChapter(ch)} disabled={deletingChapterId === ch.id}>{deletingChapterId === ch.id ? 'Đang xóa...' : 'Xóa'}</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <form className="editor stack" onSubmit={async (e)=>{ e.preventDefault(); const form = e.target; const title = form.title.value; const content = form.content.value; if(!title||!content) return alert('Cần nhập tiêu đề và nội dung'); try { await createChapter(selectedBook.id, { title, content }); const b = await getBookById(selectedBook.id); setSelectedBook(b); form.title.value=''; form.content.value=''; } catch (err) { alert(err && err.message ? err.message : 'Tạo chương thất bại') } }}>
                    <h3>Soạn chương</h3>
                    <input name="title" placeholder="Tiêu đề chương" />
                    <textarea name="content" placeholder="Nội dung chương" />
                    <div className="actions">
                      <button type="submit" disabled={isCreatingChapter} className={isCreatingChapter ? 'btn btn-primary disabled' : 'btn btn-primary'}>{isCreatingChapter ? 'Đang thêm...' : 'Thêm chương'}</button>
                    </div>
                  </form>
                </div>
              ) : (
                <div className="stack">
                  <p>Chọn một sách để quản lý chương.</p>
                  <div className="chapter-list">
                    {books.map(b => (
                      <div className="chapter-row" key={b.id}>
                        <div>
                          <div style={{fontWeight:700}}>{b.title || `Chưa có tiêu đề #${b.id}`}</div>
                          <div className="small">{b.author || 'Không rõ tác giả'}</div>
                        </div>
                        <button className="btn btn-secondary btn-small" onClick={()=>openChaptersForBook(b.id)}>Quản lý</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Edit Chapter Modal */}
          {editChapterModal && (
            <div className="modal">
              <div style={{background:'#fff',padding:20,borderRadius:8,width:720,maxWidth:'95%'}}>
                <h3>Sửa chương</h3>
                <div style={{display:'grid',gap:8}}>
                  <input value={editChapterModal.title} onChange={e=>setEditChapterModal({...editChapterModal,title:e.target.value})} />
                  <textarea value={editChapterModal.content} onChange={e=>setEditChapterModal({...editChapterModal,content:e.target.value})} rows={12} />
                  <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:6}}>
                    <button onClick={()=>setEditChapterModal(null)} style={{background:'#eee'}}>Hủy</button>
                    <button onClick={()=>submitEditChapter(editChapterModal)} disabled={savingChapter} className={savingChapter ? 'btn btn-primary disabled' : 'btn btn-primary'}>{savingChapter ? 'Đang lưu...' : 'Lưu'}</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {route === 'genres' && (
            <section className="panel">
              <h3>Thể loại / Danh mục</h3>
              <div className="split">
                <div>
                  <h4>Tạo thể loại mới</h4>
                  <form onSubmit={async (e)=>{
                    e.preventDefault()
                    if(!genreForm.name) return alert('Cần nhập tên thể loại')
                    const res = await createGenre(genreForm)
                    if(res && res.error) return alert(res.error)
                    setGenreForm({name:'',description:''})
                    load()
                  }}>
                    <input placeholder="Tên thể loại" value={genreForm.name} onChange={e=>setGenreForm({...genreForm,name:e.target.value})} style={{marginBottom:8}} />
                    <textarea placeholder="Mô tả" value={genreForm.description} onChange={e=>setGenreForm({...genreForm,description:e.target.value})} rows={3} />
                    <div style={{display:'flex',justifyContent:'flex-end',marginTop:8}}>
                      <button type="submit" className="btn btn-primary">Tạo</button>
                    </div>
                  </form>
                </div>
                <div>
                  <h4>Thể loại hiện có</h4>
                  {loading ? <p>Đang tải...</p> : genres.length === 0 ? <p>Chưa có thể loại</p> : (
                    <div style={{display:'grid',gap:8, maxHeight:'500px', overflowY:'auto', paddingRight:'8px'}}>
                      {genres.map(g=>(
                        <div className="list-row" key={g.id}>
                          <div>
                            <div style={{fontWeight:700}}>{g.name}</div>
                            {g.description && <div className="small muted">{g.description}</div>}
                          </div>
                          <div style={{display:'flex',gap:6}}>
                            <button className="btn btn-edit btn-small" onClick={()=>setEditGenreModal({...g})}>Sửa</button>
                            <button className="btn btn-delete btn-small" onClick={async()=>{
                              if(!confirm(`Xóa thể loại "${g.name}"?`)) return
                              const res = await deleteGenre(g.id)
                              if(res && res.affectedRows) { alert('Đã xóa'); load() }
                              else alert('Xóa thất bại')
                            }}>Xóa</button>
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
              <h3>Người dùng</h3>
              <div style={{ marginBottom: 12 }}>
                <button onClick={() => setCreateUserModal({ fullname: '', email: '', password: '', role: 'user' })} style={{ background: '#8b5e34', color: '#fff', padding: '6px 10px', borderRadius: 6 }}>Thêm người dùng</button>
              </div>
              {loading ? <p>Đang tải...</p> : usersError ? (
                <div className="alert error">{usersError}</div>
              ) : (
                <>
                  {users.length === 0 ? (
                    <div className="muted" style={{ padding: 10 }}>Không có người dùng hoặc bạn không có quyền xem.</div>
                  ) : (
                    <div style={{maxHeight:'500px', overflowY:'auto'}}>
                    <table style={{width:'100%',borderCollapse:'collapse'}}>
                      <thead style={{position:'sticky', top:0, zIndex:1, background:'var(--surface-header, #f8fafc)'}}>
                        <tr style={{textAlign:'left',borderBottom:'1px solid #eee'}}>
                          <th style={{padding:'8px'}}>ID</th>
                          <th style={{padding:'8px'}}>Tên</th>
                          <th style={{padding:'8px'}}>Email</th>
                          <th style={{padding:'8px'}}>Vai trò</th>
                          <th style={{padding:'8px'}}>Xu</th>
                          <th style={{padding:'8px'}}>Ngày tạo</th>
                          <th style={{padding:'8px'}}>Hành động</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map(u => (
                          <tr key={u.id} style={{borderBottom:'1px solid #f2f2f2'}}>
                            <td style={{padding:8}}>{u.id}</td>
                            <td style={{padding:8}}>{u.fullname}</td>
                            <td style={{padding:8}}>{u.email}</td>
                            <td style={{padding:8}}><span className={`role role-${u.role}`}>{roleLabel[u.role] || u.role}</span></td>
                            <td style={{padding:8,fontWeight:700}}>{typeof u.coins === 'number' ? u.coins : (u.coins ?? 0)}</td>
                            <td style={{padding:8}}>{u.created_at ? new Date(u.created_at).toLocaleString() : ''}</td>
                            <td style={{padding:8,display:'flex',gap:6,flexWrap:'wrap'}}>
                              <button className="btn btn-edit btn-small" onClick={() => handleEditUser(u)}>Sửa</button>
                              <button className="btn btn-delete btn-small" onClick={() => handleDeleteUser(u)} style={{opacity: u.role === 'admin' ? 0.7 : 1, cursor: 'pointer'}} title={u.role === 'admin' ? 'Không thể xóa tài khoản admin' : ''} disabled={false}>Xóa</button>
                              <button className="btn btn-small" onClick={() => handleAdminTopupUser(u)}>Nạp xu</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {/* Edit Book Modal */}
          {editBookModal && (
            <div className="modal">
              <div style={{background:'#fff',padding:20,borderRadius:8,width:520,maxWidth:'95%'}}>
                <h3>Chỉnh sửa sách</h3>
                <div style={{display:'grid',gap:8}}>
                  <input placeholder="Tiêu đề" value={editBookModal.title} onChange={e=>setEditBookModal({...editBookModal,title:e.target.value})} />
                  <input placeholder="Tác giả" value={editBookModal.author} onChange={e=>setEditBookModal({...editBookModal,author:e.target.value})} />
                  <select value={editBookModal.genre || ''} onChange={e=>setEditBookModal({...editBookModal,genre:e.target.value})} style={{padding:'8px',border:'1px solid #ddd',borderRadius:'4px'}}>
                    <option value="">-- Chọn thể loại --</option>
                    {genres.map(g => <option key={g.genre_id} value={g.name}>{g.name}</option>)}
                  </select>
                  <textarea placeholder="Mô tả" value={editBookModal.description} onChange={e=>setEditBookModal({...editBookModal,description:e.target.value})} />
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
            <div className="modal">
              <div style={{background:'#fff',padding:20,borderRadius:8,width:420,maxWidth:'95%'}}>
                <h3>Sửa người dùng</h3>
                <div style={{display:'grid',gap:8}}>
                  <input value={editUserModal.fullname} onChange={e=>setEditUserModal({...editUserModal,fullname:e.target.value})} />
                  <input value={editUserModal.email} onChange={e=>setEditUserModal({...editUserModal,email:e.target.value})} />
                  <select value={editUserModal.role} onChange={e=>setEditUserModal({...editUserModal,role:e.target.value})}>
                    <option value="user">Người dùng</option>
                    <option value="author">Tác giả</option>
                    <option value="admin">Quản trị</option>
                  </select>
                  <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:6}}>
                    <button onClick={()=>setEditUserModal(null)} style={{background:'#eee'}}>Hủy</button>
                    <button onClick={()=>submitEditUser(editUserModal)} disabled={editUserModal.role==='admin' && editUserModal.email==='admin@example.com' ? false : false}>Lưu</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Create User Modal */}
          {createUserModal && (
            <div className="modal">
              <div style={{background:'#fff',padding:20,borderRadius:8,width:420,maxWidth:'95%'}}>
                <h3>Tạo người dùng</h3>
                <div style={{display:'grid',gap:8}}>
                  <input placeholder="Họ tên" value={createUserModal.fullname} onChange={e=>setCreateUserModal({...createUserModal,fullname:e.target.value})} />
                  <input placeholder="Email" value={createUserModal.email} onChange={e=>setCreateUserModal({...createUserModal,email:e.target.value})} />
                  <input placeholder="Mật khẩu" type="password" value={createUserModal.password} onChange={e=>setCreateUserModal({...createUserModal,password:e.target.value})} />
                  <select value={createUserModal.role} onChange={e=>setCreateUserModal({...createUserModal,role:e.target.value})}>
                    <option value="user">Người dùng</option>
                    <option value="author">Tác giả</option>
                  </select>
                  <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:6}}>
                    <button onClick={()=>setCreateUserModal(null)} style={{background:'#eee'}}>Hủy</button>
                    <button onClick={()=>handleCreateUserSubmit(createUserModal)}>Tạo</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Edit Banner Modal */}
          {editBannerModal && (
            <div className="modal">
              <div style={{background:'#fff',padding:20,borderRadius:8,width:520,maxWidth:'95%'}}>
                <h3>Sửa banner</h3>
                <div style={{display:'grid',gap:8}}>
                  <input value={editBannerModal.title || ''} onChange={e=>setEditBannerModal({...editBannerModal,title:e.target.value})} />
                  <input value={editBannerModal.link || ''} onChange={e=>setEditBannerModal({...editBannerModal,link:e.target.value})} />
                  <label>Trạng thái</label>
                  <select value={editBannerModal.enabled ? '1' : '0'} onChange={e=>setEditBannerModal({...editBannerModal,enabled: e.target.value === '1'})}>
                    <option value="1">Bật</option>
                    <option value="0">Tắt</option>
                  </select>
                  <label>Thay ảnh</label>
                  <input type="file" accept="image/*" onChange={e=>setEditBannerModal({...editBannerModal,bannerFile: e.target.files && e.target.files[0] ? e.target.files[0] : null})} />
                  {editBannerModal.bannerFile && (<div style={{marginTop:8}}><img src={URL.createObjectURL(editBannerModal.bannerFile)} alt="xem trước" style={{maxWidth:240}} /></div>)}
                  <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:6}}>
                    <button onClick={()=>setEditBannerModal(null)} style={{background:'#eee'}}>Hủy</button>
                    <button onClick={()=>handleEditBannerSubmit(editBannerModal)}>Lưu</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {editAdModal && (
            <div className="modal">
              <div className="modal-content" style={{ maxWidth: 720 }}>
                <h3>Sửa quảng cáo video</h3>
                <label>Tiêu đề</label>
                <input value={editAdModal.title || ''} onChange={e=>setEditAdModal({...editAdModal,title:e.target.value})} />
                <label>Liên kết</label>
                <input value={editAdModal.link || ''} onChange={e=>setEditAdModal({...editAdModal,link:e.target.value})} />
                <label>Vị trí</label>
                <select value={editAdModal.placement || 'home'} onChange={e=>setEditAdModal({...editAdModal,placement:e.target.value})}>
                  <option value="home">Trang chủ</option>
                  <option value="book-open">Khi mở truyện</option>
                  <option value="reader">Khi đọc</option>
                  {editAdModal.placement && !['home', 'book-open', 'reader'].includes(editAdModal.placement) ? (
                    <option value={editAdModal.placement}>{editAdModal.placement === 'interstitial' ? 'Toàn màn hình (cũ)' : editAdModal.placement === 'banner' ? 'Banner (cũ)' : editAdModal.placement}</option>
                  ) : null}
                </select>
                <label>Trạng thái</label>
                <select value={editAdModal.enabled ? '1' : '0'} onChange={e=>setEditAdModal({...editAdModal,enabled: e.target.value === '1'})}>
                  <option value="1">Bật</option>
                  <option value="0">Tắt</option>
                </select>
                <label>Thay video (tùy chọn)</label>
                <input type="file" accept="video/*" onChange={e=>setEditAdModal({...editAdModal, videoFile: (e.target.files && e.target.files[0]) ? e.target.files[0] : null })} />
                {(editAdModal.videoFile || editAdModal.video_url) && (
                  <div style={{ marginTop: 8 }}>
                    <video src={editAdModal.videoFile ? URL.createObjectURL(editAdModal.videoFile) : editAdModal.video_url} controls style={{ width: '100%', borderRadius: 8 }} />
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                  <button className="btn btn-ghost" onClick={()=>setEditAdModal(null)}>Hủy</button>
                  <button className="btn btn-primary" onClick={()=>handleEditAdSubmit(editAdModal)}>Lưu</button>
                </div>
              </div>
            </div>
          )}

          {/* Edit Genre Modal */}
          {editGenreModal && (
            <div className="modal">
              <div style={{background:'#fff',padding:20,borderRadius:8,width:420,maxWidth:'95%'}}>
                <h3>Sửa thể loại</h3>
                <div style={{display:'grid',gap:8}}>
                  <input placeholder="Tên" value={editGenreModal.name || ''} onChange={e=>setEditGenreModal({...editGenreModal,name:e.target.value})} />
                  <textarea placeholder="Mô tả" value={editGenreModal.description || ''} onChange={e=>setEditGenreModal({...editGenreModal,description:e.target.value})} rows={3} />
                  <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:6}}>
                    <button onClick={()=>setEditGenreModal(null)} style={{background:'#eee'}}>Hủy</button>
                    <button onClick={async ()=>{
                      const res = await updateGenre(editGenreModal.id, {name: editGenreModal.name, description: editGenreModal.description})
                      if(res && res.error) return alert(res.error)
                      setEditGenreModal(null)
                      load()
                    }}>Lưu</button>
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
                        
