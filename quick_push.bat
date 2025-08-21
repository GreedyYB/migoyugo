@echo off
echo Adding all changes to git...
git add .

echo.
echo Committing changes...
set /p commit_message="Enter commit message: "
git commit -m "%commit_message%"

echo.
echo Pushing to GitHub...
git push

echo.
echo Done!
pause 