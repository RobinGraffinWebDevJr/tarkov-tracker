import { ipcMain } from 'electron'
import { execFile } from 'child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Lecture des noms affichés sur les cases avec l'OCR intégré à Windows (Windows.Media.Ocr, via
 * PowerShell). Ça ne lit que des petites images de nos propres captures d'écran, que l'interface
 * envoie ; le jeu n'est ni touché ni observé. Les images sont écrites dans un dossier temporaire
 * supprimé juste après.
 */

const MAX_IMAGES = 6000
const MAX_IMAGE_BYTES = 300_000
const TIMEOUT_MS = 240_000

// Pas de caractère d'échappement PowerShell (accent grave) ici : le script est dans une chaîne JS.
const SCRIPT = `param([string]$Dir, [string]$OutFile, [string]$Lang = 'fr-FR')
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*' })[0]
function Await($op, $type) {
    $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result
}
$engine = $null
try { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new($Lang)) } catch {}
if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if ($null -eq $engine) { [System.IO.File]::WriteAllText($OutFile, 'ERREUR-MOTEUR'); exit 2 }
$tab = [char]9
$lines = foreach ($f in Get-ChildItem $Dir -Filter *.png | Sort-Object Name) {
    $text = ''
    try {
        $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($f.FullName)) ([Windows.Storage.StorageFile])
        $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
        $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bmp = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        $res = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
        $text = ($res.Text -replace '\\s+', ' ')
    } catch {}
    $f.BaseName + $tab + $text
}
[System.IO.File]::WriteAllLines($OutFile, [string[]]$lines, [System.Text.UTF8Encoding]::new($false))
`

export interface OcrResult {
  /** Texte lu pour chaque image, dans le même ordre (chaîne vide si rien n'a pu être lu) */
  reads: string[]
  error?: string
}

function run(file: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: TIMEOUT_MS, windowsHide: true }, (err) =>
      resolve(err ? err.message : null)
    )
  })
}

async function readNames(pngs: Uint8Array[], lang: string): Promise<OcrResult> {
  const empty = pngs.map(() => '')
  if (process.platform !== 'win32')
    return { reads: empty, error: "La lecture des noms n'est disponible que sous Windows." }
  if (!Array.isArray(pngs) || pngs.length === 0) return { reads: [] }
  if (pngs.length > MAX_IMAGES) return { reads: empty, error: 'Trop d’images à lire.' }
  if (pngs.some((p) => !(p instanceof Uint8Array) || p.length > MAX_IMAGE_BYTES))
    return { reads: empty, error: 'Image invalide.' }
  const safeLang = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/.test(lang) ? lang : 'fr-FR'

  const dir = await mkdtemp(join(tmpdir(), 'tarkov-tracker-ocr-'))
  try {
    const imgDir = join(dir, 'img')
    await writeFile(join(dir, 'ocr.ps1'), SCRIPT, 'utf-8')
    await mkdir(imgDir)
    await Promise.all(
      pngs.map((p, i) => writeFile(join(imgDir, `${String(i).padStart(5, '0')}.png`), p))
    )
    const out = join(dir, 'out.tsv')
    const err = await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(dir, 'ocr.ps1'),
      '-Dir',
      imgDir,
      '-OutFile',
      out,
      '-Lang',
      safeLang
    ])
    let text = ''
    try {
      text = await readFile(out, 'utf-8')
    } catch {
      return { reads: empty, error: err ?? "L'OCR n'a rien produit." }
    }
    if (text.startsWith('ERREUR-MOTEUR'))
      return {
        reads: empty,
        error: "Aucun moteur de reconnaissance de texte Windows n'est installé pour cette langue."
      }
    const reads = [...empty]
    for (const line of text.split(/\r?\n/)) {
      const k = line.indexOf('\t')
      if (k < 0) continue
      const i = Number(line.slice(0, k))
      if (Number.isInteger(i) && i >= 0 && i < reads.length) reads[i] = line.slice(k + 1).trim()
    }
    return { reads }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export function initOcr(): void {
  ipcMain.handle('recog:ocr', (_e, pngs: Uint8Array[], lang?: string) =>
    readNames(pngs, lang ?? 'fr-FR')
  )
}
