function nextFabVisible(prevY, y, visible, threshold = 12) {
  const delta = Number(y) - Number(prevY)
  if (!Number.isFinite(delta)) return !!visible
  if (delta > threshold) return false
  if (delta < -threshold) return true
  return !!visible
}

module.exports = { nextFabVisible }
