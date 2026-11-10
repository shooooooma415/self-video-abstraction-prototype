$ErrorActionPreference = 'Stop'

$rootDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$bridgeSource = Join-Path $rootDir 'native\realsense_depth_bridge.cpp'
$cacheDir = Join-Path $rootDir '.cache'
$bridgeBinary = Join-Path $cacheDir 'realsense-depth-bridge.exe'
$objectFile = Join-Path $cacheDir 'realsense_depth_bridge.obj'

$sdkRoot = $env:REALSENSE_SDK_ROOT
if (-not $sdkRoot) {
  $sdkRoot = Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Intel RealSense SDK 2.0'
}
$includeDir = Join-Path $sdkRoot 'include'
$libraryDir = Join-Path $sdkRoot 'lib\x64'
$runtimeDll = Join-Path $sdkRoot 'bin\x64\realsense2.dll'

if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
  $vswhere = Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (Test-Path $vswhere) {
    $vsPath = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1
    $developerCommand = if ($vsPath) { Join-Path $vsPath 'Common7\Tools\VsDevCmd.bat' }
    if ($developerCommand -and (Test-Path $developerCommand)) {
      $developerEnvironment = & $env:ComSpec /d /c "call `"$developerCommand`" -arch=amd64 -host_arch=amd64 && set"
      if ($LASTEXITCODE -ne 0) { throw 'Could not initialize the Visual Studio C++ build environment.' }
      foreach ($entry in $developerEnvironment) {
        $separator = $entry.IndexOf('=')
        if ($separator -gt 0) {
          $name = $entry.Substring(0, $separator)
          $value = $entry.Substring($separator + 1)
          Set-Item -Path "Env:$name" -Value $value
        }
      }
    }
  }
}
if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
  throw 'cl.exe was not found. Install Build Tools for Visual Studio with the Desktop development with C++ workload.'
}
if (-not (Test-Path (Join-Path $includeDir 'librealsense2\rs.hpp')) -or
    -not (Test-Path (Join-Path $libraryDir 'realsense2.lib')) -or
    -not (Test-Path $runtimeDll)) {
  throw "RealSense SDK development files were not found under '$sdkRoot'. Set REALSENSE_SDK_ROOT if it is installed elsewhere."
}

New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
if (-not (Test-Path $bridgeBinary) -or
    (Get-Item $bridgeSource).LastWriteTime -gt (Get-Item $bridgeBinary).LastWriteTime) {
  & cl.exe /nologo /std:c++17 /O2 /EHsc "/I$includeDir" $bridgeSource "/Fo$objectFile" "/Fe:$bridgeBinary" `
    /link "/LIBPATH:$libraryDir" realsense2.lib ws2_32.lib
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
Copy-Item -Force $runtimeDll (Join-Path $cacheDir 'realsense2.dll')

& $bridgeBinary
exit $LASTEXITCODE
