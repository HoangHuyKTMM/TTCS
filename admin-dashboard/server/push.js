const { applicationDefault, cert, getApps, initializeApp } = require('firebase-admin/app')
const { getMessaging } = require('firebase-admin/messaging')

function messaging() {
  const appName = 'reader-push'
  let app = getApps().find(candidate => candidate.name === appName)
  if (!app) {
    const projectId = process.env.FIREBASE_PROJECT_ID || 'newsai-793dc'
    let credential = applicationDefault()
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      credential = cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
    }
    app = initializeApp({ projectId, credential }, appName)
  }
  return getMessaging(app)
}

async function sendNewChapter(tokens, chapter) {
  if (!Array.isArray(tokens) || tokens.length === 0) return []
  const results = []
  for (let index = 0; index < tokens.length; index += 500) {
    const batch = tokens.slice(index, index + 500)
    try {
      const response = await messaging().sendEachForMulticast({
        tokens: batch,
        notification: {
          title: chapter.storyTitle || 'Chương mới đã ra mắt',
          body: chapter.chapterTitle || `Chương ${chapter.chapterNo || ''}`,
        },
        data: {
          type: 'new_chapter',
          storyId: String(chapter.storyId),
          chapterId: String(chapter.chapterId),
          chapterNo: String(chapter.chapterNo || 1),
        },
        android: { priority: 'high' },
      })
      response.responses.forEach((item, responseIndex) => {
        if (!item.success) results.push({ token: batch[responseIndex], code: item.error?.code || 'send_failed' })
      })
    } catch (error) {
      console.error('[push] FCM delivery failed:', error.code || error.message)
      if (error.code === 'app/invalid-credential' || error.code === 'app/network-error') break
    }
  }
  return results
}

module.exports = { sendNewChapter }
