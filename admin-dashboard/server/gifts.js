// Catalog giá quà. Client chỉ gửi mã; số xu luôn lấy ở đây.
const GIFTS = [
  { code: 'rose', name: 'Hoa hồng', emoji: '🌹', coins: 10 },
  { code: 'milktea', name: 'Trà sữa', emoji: '🧋', coins: 50 },
  { code: 'lion', name: 'Sư tử', emoji: '🦁', coins: 100 },
  { code: 'rocket', name: 'Tên lửa', emoji: '🚀', coins: 200 },
  { code: 'crown', name: 'Vương miện', emoji: '👑', coins: 500 },
]

const MIN_QTY = 1
const MAX_QTY = 20

function getGift(code) {
  const key = String(code || '').trim()
  return GIFTS.find((gift) => gift.code === key) || null
}

module.exports = { GIFTS, MIN_QTY, MAX_QTY, getGift }
