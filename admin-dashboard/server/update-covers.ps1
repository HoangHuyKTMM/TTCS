# PowerShell script to update book covers via API
$apiBase = "http://localhost:4000"

# Get admin token (login as admin)
$loginBody = @{
    email = "admin@admin.com"
    password = "123456"
} | ConvertTo-Json

$loginResponse = Invoke-RestMethod -Uri "$apiBase/auth/login" -Method POST -Body $loginBody -ContentType "application/json"
$token = $loginResponse.token
Write-Host "Admin token: $token"

# Get all books
$books = Invoke-RestMethod -Uri "$apiBase/books" -Method GET
Write-Host "Found $($books.Count) books"

# Get all cover files
$coversDir = ".\public\covers"
$coverFiles = Get-ChildItem -Path $coversDir -Filter "*.jpg","*.png","*.jpeg" | Select-Object -ExpandProperty Name

Write-Host "Found $($coverFiles.Count) cover files"

# Update each book with a cover
for ($i = 0; $i -lt $books.Count; $i++) {
    $book = $books[$i]
    
    # Skip if book already has cover
    if ($book.cover_url) {
        Write-Host "Book $($book.id) already has cover: $($book.cover_url)"
        continue
    }
    
    # Assign cover (cycle through available covers)
    $coverFile = $coverFiles[$i % $coverFiles.Count]
    $coverUrl = "/covers/$coverFile"
    
    # Update book via API
    $updateBody = @{
        title = $book.title
        author = $book.author
        description = $book.description
        cover_url = $coverUrl
    } | ConvertTo-Json
    
    $headers = @{
        "Authorization" = "Bearer $token"
        "Content-Type" = "application/json"
    }
    
    try {
        Invoke-RestMethod -Uri "$apiBase/books/$($book.id)" -Method PUT -Body $updateBody -Headers $headers
        Write-Host "Updated book $($book.id) '$($book.title)' with cover: $coverUrl"
    } catch {
        Write-Host "Error updating book $($book.id): $_"
    }
}

Write-Host "Done!"
