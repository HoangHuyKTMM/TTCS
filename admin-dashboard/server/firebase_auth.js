const { initializeApp, getApps } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')

function authError(code, status, message) {
  return Object.assign(new Error(message), { code, status })
}

async function verifyFirebaseIdentity(idToken) {
  if (typeof idToken !== 'string' || !idToken.trim() || idToken.length > 10000) {
    throw authError('invalid_firebase_token', 401, 'Token Firebase không hợp lệ.')
  }
  // Match the Firebase project already configured in the reader client.
  const projectId = process.env.FIREBASE_PROJECT_ID || 'newsai-793dc'
  const name = 'reader-auth-' + projectId
  const app = getApps().find(app => app.name === name) || initializeApp({ projectId }, name)
  try {
    // The Admin SDK verifies signature, issuer, audience and expiry before use.
    return await getAuth(app).verifyIdToken(idToken)
  } catch (error) {
    if (['auth/internal-error', 'app/network-error', 'app/invalid-credential'].includes(error.code)) {
      throw authError('firebase_unavailable', 503, 'Chưa xác minh được đăng nhập Firebase. Thử lại sau.')
    }
    throw authError('invalid_firebase_token', 401, 'Token Firebase không hợp lệ hoặc đã hết hạn.')
  }
}

async function firebaseSession(db, idToken, verify = verifyFirebaseIdentity) {
  const identity = await verify(idToken)
  const uid = identity.uid
  if (typeof uid !== 'string' || !uid || uid.length > 128) throw authError('invalid_firebase_token', 401, 'Token Firebase không hợp lệ.')
  const email = typeof identity.email === 'string' ? identity.email.trim().toLowerCase() : null
  const fullname = typeof identity.name === 'string' ? identity.name.slice(0, 100) : email?.split('@')[0] || 'User'
  const avatar = typeof identity.picture === 'string' && identity.picture.startsWith('https://') ? identity.picture.slice(0, 500) : null
  const provider = identity.firebase?.sign_in_provider || 'firebase'
  const conn = await (await db.initPool()).getConnection()
  let session
  try {
    // Missing UID/email rows must not gap-lock the index during concurrent signup.
    // Existing rows remain locked; unique constraints resolve competing inserts.
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')
    await conn.beginTransaction()
    const [byUid] = await conn.execute('SELECT * FROM users WHERE firebase_uid=? LIMIT 1 FOR UPDATE', [uid])
    let user = byUid[0]
    let created = false
    if (!user) {
      const [byEmail] = email ? await conn.execute('SELECT * FROM users WHERE email=? LIMIT 1 FOR UPDATE', [email]) : [[]]
      user = byEmail[0]
      // A brand-new signup can proceed. Linking an existing email row needs a verified token.
      if (user && email && identity.email_verified !== true) throw authError('email_not_verified', 403, 'Hãy xác minh email Firebase trước khi liên kết tài khoản.')
      if (user?.firebase_uid && user.firebase_uid !== uid) throw authError('firebase_account_conflict', 409, 'Email đã được liên kết với tài khoản Firebase khác.')
      if (user) {
        await conn.execute('UPDATE users SET firebase_uid=?, auth_method=?, avatar_url=COALESCE(avatar_url,?) WHERE user_id=?', [uid, provider, avatar, user.user_id])
      } else {
        const [insert] = await conn.execute("INSERT INTO users (fullname,email,password_hash,role,firebase_uid,auth_method,avatar_url) VALUES (?,?,NULL,'user',?,?,?)", [fullname, email || `firebase_${uid}@noemail.local`, uid, provider, avatar])
        user = { user_id: insert.insertId, email: email || `firebase_${uid}@noemail.local`, fullname, role: 'user', avatar_url: avatar }
        created = true
      }
    }
    await conn.commit()
    session = { created, user: { id: String(user.user_id), email: user.email, name: user.fullname, role: user.role, avatar_url: user.avatar_url || avatar } }
  } catch (error) {
    await conn.rollback()
    if (error.code === 'ER_DUP_ENTRY') throw authError('firebase_account_conflict', 409, 'Tài khoản đang được liên kết. Hãy thử đăng nhập lại.')
    throw error
  } finally { conn.release() }
  // Release the transaction connection before helpers borrow from the same pool.
  if (typeof db.getUserById === 'function') {
    const fresh = await db.getUserById(session.user.id)
    if (fresh) session.user.role = fresh.role
  }
  return session
}

module.exports = { verifyFirebaseIdentity, firebaseSession }
