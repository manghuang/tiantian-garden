@echo off
set "SKYE_BLENDER=%~dp0.tools\blender-4.5.3-windows-x64\blender.exe"
if exist "%SKYE_BLENDER%" (
  start "Skye Blender" "%SKYE_BLENDER%" "%~dp0output\Skye_Rigged.blend" --python "%~dp0scripts\skye_controls.py"
) else (
  echo Open output\Skye_Rigged.blend with Blender 4.5 or later.
  pause
)
