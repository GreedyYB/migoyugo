@echo off
echo Adding all changes...
git add .
echo.
set /p message="Enter commit message: "
echo.
echo Committing with message: %message%
git commit -m "%message%"
echo.
echo Pushing to GitHub...
git push origin master
echo.
echo Done!
pause 