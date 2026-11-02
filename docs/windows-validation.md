# Windows 단계 A 검증

현재 환경은 macOS 26.3 arm64이며 Windows 커널/VM/원격 Windows 실행 환경과 Wine/PowerShell이 없다. Windows 테스트·NSIS 빌드는 **미실행**, 실제 설치/GUI 확인은 **미검증**이다. macOS Electron 테스트 성공을 Windows 검증으로 표시하지 않는다. 이번에는 원격 저장소 업로드나 CI 실행을 하지 않았다.

## Windows 11 x64에서 실행

GUI 데스크톱에 로그인한 Windows 11 x64 장비에 Node 24.22.2와 npm, Git을 준비한다. 이 작업 폴더의 미커밋 코드를 포함한 전체 소스와 lockfile이 필요하다. 저장소의 과거 커밋만 clone하면 이번 수정이 포함되지 않는다. 개발 의존성/바이너리 다운로드에 인터넷이 필요하다.

PowerShell에서 저장소 루트로 이동해 실행한다. 설치와 테스트 오류를 다음 명령이 가리지 않도록 각 종료 코드를 검사한다.

```powershell
$ErrorActionPreference = 'Stop'
function Invoke-Checked([string] $Program, [string[]] $Arguments) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Program failed: $LASTEXITCODE" }
}
Invoke-Checked 'node.exe' @('--version')
Invoke-Checked 'npm.cmd' @('ci')
Invoke-Checked 'npx.cmd' @('--no-install', 'install-electron', '--no')
Invoke-Checked 'npm.cmd' @('run', 'typecheck')
Invoke-Checked 'npm.cmd' @('run', 'lint')
Invoke-Checked 'npm.cmd' @('test')
Invoke-Checked 'npm.cmd' @('run', 'test:e2e')
Invoke-Checked 'git.exe' @('diff', '--check')
Invoke-Checked 'npm.cmd' @('run', 'package:win')
Get-ChildItem .\release -Recurse -Filter *.exe
```

`package:win`은 production build 후 electron-builder로 Windows x64 NSIS를 만들며 `--publish never`를 사용한다. 자동 업데이트·코드 서명 자격 증명을 설정하지 않았다. 기본 예상 산출물은 `release\PhotoKkumi Setup 0.1.0.exe`이며 실제 생성된 경로를 위 목록과 빌드 로그에서 확인한다. 서명되지 않은 테스트용 빌드다. Windows 보안 설정을 낮추거나 경고 우회를 요구하지 않는다.

선택적으로 `npx --no-install asar list .\release\win-unpacked\resources\app.asar`로 목록을 확인한다(`@electron/asar`의 asar CLI는 현재 builder 전이 의존성). `node_modules/minimatch`, ESLint, electron-builder 등이 앱 ASAR에 포함되지 않았는지 확인하고 결과를 기록한다. 번들로 포함된 코드도 main/preload/renderer 소스맵 또는 빌드 설정과 함께 확인한다. 설치 파일이 생긴 것만으로 감사 범위 밖 바이너리의 보안을 보장하지 않는다.

## 사람이 확인할 체크리스트

- [ ] 설치 → 실행 → 한글·공백·긴 경로의 JPG/PNG 사진과 투명 PNG 스티커 열기. 인터넷을 끊어도 편집/저장 가능.
- [ ] 이동·모서리 비율 유지 크기·회전 → PNG 저장. 원본 크기, 알파, 배치/잘림 확인. DPI 100%와 150%에서 조작 확인.
- [ ] NTFS 폴더와 하드 링크 없는 exFAT/FAT 출력 장치에 각각 저장. 같은 이름으로 반복 저장해 숫자 suffix와 기존 결과 보존 확인. 가능하면 앱 두 프로세스에서 같은 사진/폴더에 동시 저장.
- [ ] 권한 없는 폴더·저장 대화상자 취소 → 사진/스티커/각도 유지, 다른 폴더로 재시도. 작업이 끝난 뒤 실패한 PNG/`.tmp`가 남지 않았는지 확인. OS가 삭제를 거부하면 앱의 정리 실패 안내를 확인하고 파일 상태를 기록.
- [ ] 수정 후 X/Alt+F4와 앱 종료 요청: 저장·버리기·취소 각각 확인. 저장 실패·폴더 선택 취소는 종료 취소. 저장 성공만 닫힘. 작업 중 반복 닫기도 확인.
- [ ] 저장 전후 원본 사진·스티커 `Get-FileHash -Algorithm SHA256` 일치 확인. 기존 출력 해시 보존 확인.
- [ ] 재실행하면 새 한 장 세션으로 시작함을 확인하고, 앱 제거 흐름 확인. 원본/내보낸 파일이 삭제되지 않아야 함.

## 결과 기록 양식

Windows 버전/아키텍처, DPI, Node/npm/Electron 버전, 실행 명령, 통과/실패 수, 설치 파일 실제 경로·SHA-256·서명 상태를 기록한다.

- 자동 테스트: 대기
- Windows x64 NSIS 패키징: 대기
- ASAR 의존성 포함 목록: 대기
- 설치/GUI/오프라인/제거: 대기
- NTFS 및 실제 exFAT/FAT/경합/권한/긴 경로: 대기

패키징 성공과 사람이 설치한 앱을 검증한 결과를 각각 적는다. 실패 시 단계 A 문제만 수정하고 라이브러리·다중 사진 기능으로 범위를 넓히지 않는다.

## 단계 B 추가 확인

단계 A의 Windows E2E 11개와 기본 수동 편집/저장은 사용자 성공 보고를 받았다. 다음은 이번 단계 B 수정 이후 다시 확인해야 한다. `npm ci`로 추가 ZIP 의존성을 설치한 뒤 기존 명령을 수행한다. E2E는 현재 13개다.

- [ ] 여러 PNG 등록 → 이름/분류/즐겨찾기 변경 → 원본 PNG 이동 → 앱 완전 종료/재실행 → 유지 및 썸네일 확인.
- [ ] 라이브러리 클릭 배치·PNG 저장, 현재 사용 중 삭제 차단, 다른 항목 삭제 시 원본 보존.
- [ ] ZIP 백업 → 다른 테스트 프로필에서 복원 → 재복원 중복 없음. 취소/잘못된 ZIP은 기존 항목 유지.
- [ ] 설치본의 실제 userData 경로와 업그레이드 후 라이브러리 유지, 권한 거부 폴더에서 오류 안내 확인.

단계 B 테스트·NSIS 빌드·실제 설치/GUI 결과: 대기.
