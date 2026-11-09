import { expect, it } from 'vitest'
import { mkdtemp, writeFile, rm, symlink, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolStore, VideoStore, candidatePaths } from '../src/main/ffmpeg'

it('동영상은 MOV/MP4 일반 파일만 등록하고 symlink·상대 경로·다른 확장자를 거부하며 같은 파일은 같은 ID', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'photokkumi-video-'))
  try {
    const clip = join(dir, 'IMG_0001.MOV'), text = join(dir, 'a.txt'), link = join(dir, 'link.mov')
    await writeFile(clip, 'x'); await writeFile(text, 'x'); await symlink(clip, link)
    const store = new VideoStore()
    const ref = await store.add(clip)
    expect(ref.name).toBe('IMG_0001.MOV')
    expect((await store.add(clip)).id).toBe(ref.id)
    for (const bad of [text, link, 'IMG.mov', join(dir, 'missing.mp4')]) await expect(store.add(bad)).rejects.toThrow()
    expect(() => store.get('00000000-0000-4000-8000-000000000000')).toThrow()
    store.clear(); expect(() => store.get(ref.id)).toThrow()
  } finally { await rm(dir, { recursive: true, force: true }) }
})

it('ffmpeg를 찾지 못하면 미설치 상태이고, ffmpeg가 아닌 파일 지정은 거부하며 설정 파일을 만들지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'photokkumi-tools-'))
  try {
    const fake = join(dir, 'ffmpeg.exe'); await writeFile(fake, 'not a program')
    const store = new ToolStore(dir, async () => [join(dir, 'missing'), fake])
    expect(await store.locate()).toEqual({ found: false, path: null, version: null })
    expect(() => store.require()).toThrow('ffmpeg')
    await expect(store.choose(fake)).rejects.toThrow('ffmpeg가 아닙니다')
    await expect(readFile(join(dir, 'tools.json'))).rejects.toThrow()
    await writeFile(join(dir, 'tools.json'), '{broken')
    expect((await store.locate()).found).toBe(false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

it('Windows 후보에는 winget 링크·패키지 폴더·Program Files·scoop·choco 위치가 들어간다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'photokkumi-winget-'))
  try {
    await mkdir(join(dir, 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe', 'ffmpeg-8.0-full_build'), { recursive: true })
    const list = await candidatePaths({ LOCALAPPDATA: dir, ProgramFiles: 'C:\\Program Files', USERPROFILE: 'C:\\Users\\a', ChocolateyInstall: 'C:\\ProgramData\\chocolatey' }, 'win32')
    expect(list[0]).toBe('ffmpeg')
    expect(list).toContain(join(dir, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'))
    expect(list).toContain(join(dir, 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe', 'ffmpeg-8.0-full_build', 'bin', 'ffmpeg.exe'))
    expect(list.some(item => item.includes('scoop'))).toBe(true)
    expect(list.some(item => item.includes('chocolatey'))).toBe(true)
    expect(await candidatePaths({}, 'darwin')).toContain('/opt/homebrew/bin/ffmpeg')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
