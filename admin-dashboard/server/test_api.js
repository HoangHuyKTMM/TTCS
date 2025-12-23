(async () => {
  try {
    const base = 'http://localhost:4000'
    console.log('Creating book via JSON POST...')
    const createRes = await fetch(`${base}/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'API JSON Test', author: 'Tester', description: 'Created via JSON' })
    })
    const created = await createRes.json()
    console.log('CREATE STATUS', createRes.status)
    console.log('CREATE BODY', created)
    if (!created || !created.id) {
      console.error('Create did not return id; aborting')
      process.exit(1)
    }
    const id = created.id
    console.log('Updating book id', id)
    const updateRes = await fetch(`${base}/books/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated Title via JSON' })
    })
    const updated = await updateRes.json()
    console.log('UPDATE STATUS', updateRes.status)
    console.log('UPDATE BODY', updated)
    process.exit(0)
  } catch (err) {
    console.error('Test error', err)
    process.exit(2)
  }
})()
