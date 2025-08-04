param(
    [string]$Message = "Auto-commit: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
)

Write-Host "🔄 Auto-Push Script Starting..." -ForegroundColor Cyan
Write-Host "📁 Adding all changes..." -ForegroundColor Yellow

try {
    git add .
    
    # Check if there are changes to commit
    $status = git status --porcelain
    if ([string]::IsNullOrEmpty($status)) {
        Write-Host "✅ No changes to commit!" -ForegroundColor Green
        return
    }
    
    Write-Host "💾 Committing with message: '$Message'" -ForegroundColor Yellow
    git commit -m $Message
    
    Write-Host "🚀 Pushing to GitHub..." -ForegroundColor Yellow
    git push origin master
    
    Write-Host "✅ Successfully pushed to GitHub!" -ForegroundColor Green
    
    # If Railway is connected, it will auto-deploy
    Write-Host "🚂 Railway will auto-deploy shortly..." -ForegroundColor Magenta
    
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
} 