# Runs Nourish's phone UI tests (.maestro) on the Android emulator on this PC.
#
#   powershell -ExecutionPolicy Bypass -File tools\phone-ui-test.ps1            # latest Android build from GitHub
#   powershell -ExecutionPolicy Bypass -File tools\phone-ui-test.ps1 -Apk C:\path\Nourish.apk
#   ... -Flow 03-log-food                                                       # one flow only
#
# It starts the emulator (AVD "Nourish_Pixel") if it isn't running, installs the app, runs the
# flows and saves screenshots, a report and logs in phone-ui-results\
# (kept out of git). Needs: the Android SDK in %USERPROFILE%\Android\Sdk (or ANDROID_HOME), Maestro
# in %USERPROFILE%\maestro, Java 17+, and the GitHub CLI (gh) for downloading the latest build.
param(
    [string]$Apk = "",
    [string]$Avd = "Nourish_Pixel",
    [string]$Flow = ""
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif (Test-Path "$env:USERPROFILE\Android\Sdk") { "$env:USERPROFILE\Android\Sdk" } else { "$env:LOCALAPPDATA\Android\Sdk" }
$adb = Join-Path $sdk "platform-tools\adb.exe"
$emulator = Join-Path $sdk "emulator\emulator.exe"
$maestro = Join-Path $env:USERPROFILE "maestro\bin\maestro.bat"
$out = Join-Path $repo "phone-ui-results"
foreach ($tool in @($adb, $emulator, $maestro)) { if (-not (Test-Path $tool)) { throw "Missing $tool (see the phone testing report for setup)" } }
if (-not $env:JAVA_HOME) {
    $jdk = Get-ChildItem "$env:ProgramFiles\Eclipse Adoptium" -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
    if ($jdk) { $env:JAVA_HOME = $jdk.FullName }
}
$env:ANDROID_HOME = $sdk
$env:MAESTRO_CLI_NO_ANALYTICS = "1"

# 1. The emulator.
$running = (& $adb devices) -match "^emulator-\d+\s+device"
if (-not $running) {
    Write-Host "Starting the emulator $Avd ..."
    Start-Process -FilePath $emulator -ArgumentList "-avd", $Avd, "-no-snapshot-save", "-no-boot-anim" -WindowStyle Minimized
    & $adb wait-for-device
    do { Start-Sleep -Seconds 3; $boot = (& $adb shell getprop sys.boot_completed 2>$null) } until ("$boot".Trim() -eq "1")
}
# Screen on, unlocked, and nothing pulled down over the app.
& $adb shell input keyevent KEYCODE_WAKEUP
& $adb shell wm dismiss-keyguard
& $adb shell cmd statusbar collapse
# Gboard's "Try out your stylus" lesson pops up over text boxes on test taps; turn handwriting off.
& $adb shell settings put secure stylus_handwriting_enabled 0
Write-Host "Emulator ready."

# 2. The app: a given APK, or the newest Android build of main from GitHub Actions.
if (-not $Apk) {
    $dl = Join-Path $out "apk"
    Remove-Item -Recurse -Force $dl -ErrorAction SilentlyContinue
    # The newest run that has the Android file (a run still building, or one whose Android job failed, has none).
    $runs = gh run list --repo nyz2x4pcqr-sudo/Nourish --workflow build-mobile.yml --branch main --limit 10 --json databaseId -q '.[].databaseId'
    foreach ($run in $runs) {
        gh run download $run --repo nyz2x4pcqr-sudo/Nourish -n Nourish-android -D $dl 2>$null
        if (Test-Path (Join-Path $dl "Nourish.apk")) { Write-Host "Using the Android build from run $run"; break }
    }
    $Apk = Join-Path $dl "Nourish.apk"
    if (-not (Test-Path $Apk)) { throw "No Android build found on GitHub; pass -Apk <path>" }
}
# adb prints install errors on stderr; read them as text instead of stopping the script.
$ErrorActionPreference = "Continue"
$install = (& $adb install -r -d $Apk 2>&1 | Out-String)
Write-Host $install.Trim()
if ($install -match "INSTALL_FAILED_UPDATE_INCOMPATIBLE") {
    # Each GitHub build is signed with a new key, so Android refuses it as an update. Remove the old
    # copy (and its data: the flows start from first launch anyway) and install the new one.
    Write-Host "The installed app was signed differently; removing it and installing this build."
    & $adb uninstall io.github.nourish.app | Out-Host
    $install = (& $adb install $Apk 2>&1 | Out-String)
    Write-Host $install.Trim()
}
$ErrorActionPreference = "Stop"
# Never test an old copy by mistake: stop if the install didn't work.
if ($install -notmatch "Success") { throw "Installing $Apk failed" }

# 3. The flows.
New-Item -ItemType Directory -Force $out | Out-Null
$target = if ($Flow) { Join-Path $repo ".maestro\flows\$Flow.yaml" } else { Join-Path $repo ".maestro" }
& $adb logcat -c
& $maestro test $target --format junit --output (Join-Path $out "report.xml") `
    --test-output-dir (Join-Path $out "screens") --debug-output (Join-Path $out "debug")
$code = $LASTEXITCODE
& $adb logcat -d -s "chromium:*" "Nourish:*" "AndroidRuntime:E" > (Join-Path $out "logcat.txt")
Write-Host ""
Write-Host "Screenshots and logs: $out"
exit $code
