# 단계 B 최초 구현 기록

여러 스티커 추가·개별 선택·복제·삭제·순서·undo/redo 변경은 [여러 스티커 수정](./multiple-stickers.md)을 기준으로 한다. 아래 한 스티커 제한과 테스트 수는 최초 구현 당시 기록이다.

범위: PNG 다중 등록과 앱 관리 복사본, 라이브러리 이름/분류/즐겨찾기, 재실행 유지, 삭제, 버전 ZIP 백업·검증 후 병합 복원. 한 장 사진·한 스티커 편집은 유지한다.

검증: 먼저 저장소 계층의 중복/재시작/원본 이동/manifest 쓰기 실패/악성 ZIP 테스트 → 구현 → Electron에서 등록·클릭·편집·저장·메타데이터·삭제·백업 복원·재실행. 단계 A 회귀 및 typecheck/lint/build/audit/diff 검사를 수행한다.

결정: userData 하위 stickers/<UUID>.png와 schemaVersion=1 library.json을 쓴다. PNG를 실제 디코드·재인코딩한 뒤 SHA-256으로 중복을 합친다. 복원은 모든 항목을 임시 공간에서 검증한 뒤 manifest를 한 번 교체한다. 기존 항목의 메타데이터는 병합 시 우선한다. 현재 캔버스에서 쓰는 asset은 삭제를 막는다. 라이브러리 단일 인스턴스 잠금과 IPC 직렬화를 적용한다. 테스트는 별도 --user-data-dir 프로필을 사용한다.

## 구현과 안전성

- 라이브러리 경로는 `app.getPath('userData')`다. 일반 실행의 OS별 앱 데이터 경로를 사용한다. 명시적 `--user-data-dir`가 있으면 그 프로필을 사용하므로 테스트는 실제 사용자 라이브러리에 접근하지 않는다. 같은 프로필의 앱 두 개가 동시에 manifest를 쓰지 않도록 Electron 단일 인스턴스 잠금을 사용한다.
- `library.json`은 schemaVersion 1, 안전한 UUID, 파일 SHA-256, 원본 파일명(경로 없음), 이름/분류/즐겨찾기/크기를 포함한다. 실제 PNG 파일명은 `stickers/<UUID>.png`다. PNG 헤더/픽셀 제한 → nativeImage 실제 디코드 → 픽셀 PNG 재인코딩 후 해시 중복 제거를 한다. 같은 PNG 재등록은 기존 메타데이터를 유지한다.
- 등록과 복원은 새 후보 전부 검증 후 staging 폴더에 준비한다. 새 파일은 독점 복사한다. [Windows FlushFileBuffers의 쓰기 권한 요구](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)에 맞춰 새 PNG를 r+ 핸들로 sync하고, manifest를 임시 파일 write/sync/close → 같은 폴더 rename으로 교체한다. 실패 시 새 파일만 정리하고 기존 manifest는 보존한다. 손상된 기존 manifest를 빈 데이터로 덮지 않는다.
- 삭제는 사용 중 asset ID를 main에서도 차단한다. 관리 복사본만 삭제하며 원본 파일은 건드리지 않는다. manifest 변경 후 PNG 삭제가 실패하면 기존 manifest로 되돌려 항목을 유지한다. 이 복구까지 실패하면 파일 보존/복구 실패를 알리고 UI는 실제 목록을 다시 읽는다.
- 썸네일은 `app://bundle/stickers/<등록된 UUID>.png`에서만 제공한다. 임의 경로 API는 없다. 읽기와 디코드를 직렬 처리하며 160×160 이하 PNG 캐시를 최대 100개 유지한다. 목록은 lazy image 로딩을 사용하고, 원본 해상도 bitmap은 현재 편집 스티커 하나만 renderer에서 디코드한다.
- 사진은 한 장, 배치 스티커도 한 개로 유지한다. `PNG 스티커 열기`는 여러 PNG를 라이브러리에 등록하고 첫 번째를 배치하는 빠른 경로다. `PNG 등록`은 사진 없이도 쓸 수 있고 등록 후 라이브러리 항목을 클릭해 배치한다. 이름/분류 편집과 즐겨찾기, 필터, 삭제 확인을 제공한다.

## ZIP 백업과 복원

- `yauzl 3.4.0`, `yazl 3.3.1`과 타입 패키지를 exact 버전/lockfile로 추가했다. 공식 문서: [yauzl](https://github.com/thejoshwolfe/yauzl), [yazl](https://github.com/thejoshwolfe/yazl). 다른 네이티브 이미지 모듈은 추가하지 않았다.
- 백업 폴더를 선택하면 `PhotoKkumi-library_kkumi.zip`을 만들고 충돌 시 숫자 suffix를 쓴다. 단계 A의 독점 생성/하드 링크 폴백을 재사용하여 기존 파일을 덮지 않는다.
- ZIP에는 버전 manifest와 해당 PNG만 넣는다. 복원은 입력 ZIP을 제한 크기로 읽고 lazy entry 방식으로 임시 메모리에 검증한다. 파일명을 디스크 경로로 추출하지 않는다. manifest, UUID 파일명, entry 수·크기, actual 해제 크기, CRC32, SHA-256, PNG 실제 디코드/크기를 검사한 후 staging 및 병합한다.
- 절대 경로, `..`, 역슬래시, symlink/특수 파일, 디렉터리, 중복 항목, 암호화, 미지원 압축 방식, 알 수 없는 파일과 schemaVersion, 해시/CRC 손상, 과도한 항목/크기를 거부한다. 기존 동일 해시 항목의 ID와 메타데이터를 우선한다. 새 항목의 ID는 새 UUID로 발급한다.
- 제한: 최대 100개, 스티커 파일당 32 MiB·400만 픽셀·한 변 8,192 px, 라이브러리 PNG 총 256 MiB, manifest 256 KiB, ZIP 272 MiB, 압축 해제 PNG 총 256 MiB(+manifest). ZIP 상한을 raw 라이브러리보다 크게 잡아 비압축성 PNG의 ZIP 오버헤드를 허용한다. ZIP 입력/출력과 등록 후보를 메모리에 보관하므로 한도 근처의 백업은 수백 MiB의 메모리를 쓸 수 있다. 최대 용량의 실장비 메모리 측정은 남아 있다.

## 실제 검증 결과

환경: macOS 26.3 arm64, npm 스크립트 Node 24.22.2 / Electron 45.2.1. 사용자 사진 없이 직접 만든 도형 fixture를 별도 임시 프로필에서 사용했다.

| 명령 | 결과 |
| --- | --- |
| `npm test` | 단위/파일 I/O 35개 통과 (기존 21 + 라이브러리/ZIP 14) |
| `npm run test:e2e` | 기존 11 + 라이브러리 2 = 13개 통과 |
| `npm run typecheck`, `npm run lint` | 통과 |
| `npm run build` | Electron E2E 사전 빌드에서 main/preload/renderer 통과 |
| `npm audit --json` | 기존 minimatch advisory 1개, 전파 패키지 25개 유지 |
| `npm audit --omit=dev --json` | 0건. ZIP 의존성 추가로 새 advisory 없음 |
| `git diff --check`, 새 파일 공백 검사 | 통과 |

실패 재현 → 구현: library 모듈이 없는 상태에서 테스트 실패를 확인했다. manifest 교체/관리 파일 복사 실패, PNG 디코드 실패로 일부만 등록되지 않는지 검증했다. 중복 등록, 원본 이동, 새 인스턴스에서 메타데이터 유지, 참조 삭제 거부, 삭제 권한 실패 시 manifest 복구, 백업 round-trip/중복 병합, 악성 ZIP 경로·symlink·CRC·크기·항목 수·schema 거부를 파일 테스트로 확인했다.

실제 Electron에서는 다중 등록/중복 제거 → 이름·분류·즐겨찾기 → 원본 PNG 제거 후 앱 프로세스 재시작 → 썸네일과 메타데이터 유지 → 사진 열기 → 라이브러리 클릭 배치 → PNG 저장 → 미사용 항목 삭제/원본 보존을 확인했다. 사용 중 삭제는 UI 비활성화와 main API 거부를 모두 확인했다. ZIP 백업/빈 라이브러리 복원/재복원 병합/복원 취소/손상 ZIP 실패 시 항목 보존과 임의 asset 경로 거부도 확인했다. 단계 A 이동·회전·크기·출력 픽셀·원본 해시·종료 경고·배율 회귀도 유지했다.

## 남은 검증과 범위

- 사용자에게서 단계 A Windows E2E 11개 및 기본 수동 편집·저장 성공을 보고받았다. **이번 단계 B 코드는 Windows에서 아직 검증하지 않았다.** Windows 앱 데이터 경로, 설치본 재실행 유지, 라이브러리 권한 실패, ZIP 왕복을 확인해야 한다. 패키징/실제 GUI 완료와 구분한다.
- 전원 중단/프로세스 강제 종료 시 임시 파일이나 아직 manifest에 연결되지 않은 PNG가 남을 수 있다. 자동 정리·프로젝트 복구 기능은 추가하지 않았다. 라이브러리 최대 용량 장시간 메모리와 Windows 백신/동기화 폴더의 잠금은 미검증이다.
- 라이브러리 파일/manifest가 손상되면 오류를 내고 수정을 막는다. 자동 리셋/원본 삭제는 하지 않는다. 새 프로필 또는 검증된 백업으로 복구하는 별도 도구는 이번 범위 밖이다.
- 다중 사진, 복수 스티커 인스턴스, undo/redo, 저장하고 다음, 출력 리사이즈, 프로젝트 자동 저장/복구는 추가하지 않았다. 사용자 요청에 따라 Windows 테스트가 필요한 변경은 로컬 검증 후 커밋·푸시한다.
