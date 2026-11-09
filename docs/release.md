# 설치 파일 배포 (GitHub Releases)

`.github/workflows/release.yml`: `v*` 태그를 푸시하면 GitHub Actions의 Windows 서버에서 빌드한다.

1. `package.json`의 `version`을 올리고 커밋·푸시한다(예: `0.1.1`).
2. 태그를 만든다: `git tag v0.1.1 && git push origin v0.1.1` (태그와 version이 다르면 빌드가 실패한다).
3. Actions가 `npm ci → typecheck → lint → 단위 테스트 → Windows E2E → electron-builder(NSIS x64)` 순서로 실행하고, 설치 파일을 **임시 저장(draft) Release**에 붙인다.
4. 저장소 → Releases에서 draft를 열어 설치 파일을 내려받아 확인한 뒤 **Publish release**를 누르면 공개된다. 공개 전에는 다른 사람에게 보이지 않는다.

- 태그가 없는 평소 푸시는 아무것도 빌드하지 않는다.
- 같은 태그로 다시 실행하면 draft의 파일만 교체한다.
- E2E가 실패하면 설치 파일을 만들지 않고, 결과(`test-results/`)를 Actions 아티팩트로 7일 보관한다. 러너에 ffmpeg가 없어 GIF E2E는 건너뛴다.
- 코드 서명 없음: 첫 실행 시 Windows SmartScreen 경고("추가 정보 → 실행")가 뜬다. 서명·자동 업데이트·macOS dmg는 설정하지 않았다.

## 자동 업데이트 (0.1.2부터)
- `electron-updater` 6.8.11, GitHub provider(`minipaper/photokkumi`). 설치 파일에 `app-update.yml`이 들어가고, Release에는 설치 파일과 함께 `latest.yml`·`.blockmap`을 올린다(설치 파일 이름은 공백 없는 `PhotoKkumi-Setup-<version>.exe`).
- **공개(Publish)한 Release만** 업데이트 대상. draft는 설치된 앱에 보이지 않으므로 "빌드 → 확인 → 공개" 순서가 그대로 배포 시점이 된다.
- 동작(설치한 Windows 앱만, 개발 실행·macOS는 꺼짐):
  - 시작 5초 뒤와 6시간마다 조용히 확인. 오프라인·GitHub 오류는 표시하지 않음.
  - 새 버전이 있으면 상태 줄 오른쪽에 `새 버전 x.y.z [업데이트] [나중에]`. 자동으로 내려받지 않음.
  - `업데이트` → 진행률 → `다시 시작해서 설치`. 설치 버튼은 창을 일반 닫기 흐름으로 닫아 **미저장 편집이 있으면 저장·버리기·취소를 먼저 묻고**, 창이 닫힌 뒤에만 조용히 설치하고 다시 실행한다. 취소하면 설치하지 않는다.
  - 내려받은 뒤 그냥 종료해도 종료 시 설치된다(`autoInstallOnAppQuit`).
  - 상태 줄의 `v현재버전`을 누르면 즉시 확인.
- 보안: 네트워크 요청은 main 프로세스에서만(github.com). renderer에는 확인·내려받기·설치·상태 구독 4개 API만 노출하고, 상태는 preload에서 형식·버전 문자열을 검증한다. 서명이 없으므로 업데이트 무결성은 `latest.yml`의 sha512 확인에 의존한다.
- 0.1.1에는 업데이트 기능이 없어 0.1.2는 한 번 직접 설치해야 한다. 실제 업데이트 동작은 0.1.2 설치 후 0.1.3을 공개해 확인한다(미검증).
