# 단계 A 최초 구현 기록

이 문서는 최초 구현 당시의 검증 기록이다. 하드 링크 폴백·종료 경고 및 최신 테스트 결과는 [단계 A 안정화](./stage-a-stabilization.md)를, 감사와 Windows 절차는 해당 문서의 링크를 기준으로 한다.

- 범위: Electron 창, 한 장의 JPG/PNG 사진, PNG 스티커 하나, 이동/비율 유지 크기 조절/회전, 원본 해상도 PNG 저장. 라이브러리·다중 사진·undo/redo·리사이즈·JPG 출력은 후속 단계다.
- 순서: 순수 좌표/이미지 제한/안전 저장 테스트 → 구현 → Electron 실제 편집과 합성 결과 검증.
- 검증: Vitest 파일 I/O/검증, Playwright Electron UI/PNG 픽셀/원본 SHA-256/실패·취소 유지, typecheck/lint/build/diff check.
- 원점: EXIF 적용 후 원본의 왼쪽 위. 스티커는 중심 x/y, 양의 width/height(원본 픽셀), 시계 방향 rotation(도), z-order=0. 화면 fit 배율은 보기 전용이다.
- 단계 A 출력은 손실 없는 PNG로 고정하여 좌표·투명도 검증에 집중한다. 저장 대화상자에서 폴더만 선택하고 충돌 없는 이름으로 새 파일을 만든다.
- 공식 문서 확인: [electron-vite](https://electron-vite.org/guide/), [Electron 보안](https://www.electronjs.org/docs/latest/tutorial/security), [Konva Transformer](https://konvajs.org/docs/react/Transformer.html), [Playwright Electron](https://playwright.dev/docs/api/class-electron).

## 구현 결정

- Electron 45.2.1 / electron-vite 6.0.0 / Vite 8.3.5 / React 19.3.1 / react-konva 19.3.2 / Konva 10.9.1. npm registry의 실제 engines/peerDependencies 확인 후 lockfile 고정. Node 24.22.2 LTS를 `.nvmrc` 및 개발 의존성에 고정했다. 호스트 Node 25.8.2 대신 npm 스크립트는 로컬 Node 24를 사용한다.
- renderer는 로컬 `app://bundle` 정적 HTML/JS/CSS만 로드한다. CSP, sandbox, context isolation, Node 차단, navigation/window.open/권한 요청 차단을 설정했다. 개발 서버와 HMR 예외는 개발 빌드에만 있다.
- preload는 사진 선택/PNG 선택/PNG 저장 3개 API만 노출한다. 파일 대화상자 결과를 main 내부 ID에 매핑한다. 임의 경로나 범용 파일 읽기를 허용하지 않는다. ID·payload·sender·main frame·정확한 URL·동시 요청을 검증한다.
- 입력은 magic/header → 픽셀 제한 → 실제 디코드 순으로 검증한다. 고정 크기 읽기로 파일 증가 경합 시 할당량을 제한한다. 32 MiB / 사진 16,000,000px / 스티커 4,000,000px / 한 변 8,192px. PNG 출력은 80 MiB 제한이다. 이미지 방향은 Chromium ImageBitmap에서 한 번 적용한다.
- 미리보기는 원본 좌표에 fit 배율만 적용한다. Transformer scale을 실제 width/height로 환산하고 scale=1로 초기화한다. 저장은 별도 원본 크기 Canvas를 사용하고 PNG로 인코딩한다. main에서 원본 ID/크기/PNG 디코드를 다시 검사하고 픽셀만 재인코딩한다.
- 임시 파일을 `wx`로 생성·쓰기·fsync한 뒤 같은 폴더에서 exclusive hard link로 최종 이름을 확정한다. 이름 경합과 원본/기존 파일 덮어쓰기를 막는다. `finally`에서 임시 파일 정리를 시도한다. 정상 취소·쓰기 실패 시 편집 상태를 유지한다. 하드 링크가 없는 FAT/exFAT 등은 현재 지원하지 않는다. 전원 중단 시 임시 파일 복구/정리는 후속 과제다.
- 한 장의 세션만 지원한다. 스티커 선택을 다시 하면 기존 하나를 교체한다. 라이브러리·다중 사진·undo/redo·미저장 종료 확인은 단계 B/C로 남겼다. 사진 교체 버튼은 첫 사진을 연 뒤 비활성화한다.
- 현재 사진/스티커 bitmap은 교체·컴포넌트 해제 시 close하고, 합성 Canvas는 인코딩 후 크기를 0으로 해제한다. 이미지 파일/object URL을 원격으로 노출하지 않는다.

## 실제 검증 결과

환경: macOS 26.3 (25D125), arm64, npm 11.11.1, npm 스크립트 Node 24.22.2, Electron 45.2.1. 개인 사진 없이 테스트가 임시 폴더에 생성한 단색 PNG와 최소 EXIF JPG만 사용했다.

| 명령 | 결과 |
| --- | --- |
| `npm test` | Vitest 2 파일, 6 테스트 통과 |
| `npm run test:e2e` | 실제 Electron 4 테스트 통과 (4.1초). 빌드 포함 |
| `npm run typecheck` | 통과 |
| `npm run lint` | 통과 |
| `npm run build` | main/preload/renderer 빌드 통과 |
| `npm run dev`, `npm start` | 로컬 서버/앱 시작 로그 확인 후 종료. 수동 편집 검증과 구분 |
| `git diff --check`, 새 파일별 `git diff --no-index --check` | 통과 |
| `npm audit --omit=dev` | 런타임 의존성 0건 |
| `npm audit` | moderate 25건: 개발/패키징 도구의 minimatch 관련 전이 의존성. 호환성 없는 downgrade 미적용 |

검증한 동작:

- fit 배율과 배치 유효성, 실제 PNG 헤더/파일 크기/픽셀 수 제한.
- 한글·공백 경로에서 사진·스티커 열기, 실제 마우스로 이동·모서리 리사이즈·회전 핸들 조작. 숫자 입력으로 정밀 배치.
- 1200×800 사진의 축소 프리뷰와 원본 해상도 PNG를 다시 디코드해 네 지점 픽셀 정확 일치. 90° 회전의 빨강/초록 방향, 투명 영역, 사진 밖 스티커 clipping.
- 사진과 스티커의 저장 전후 SHA-256 일치, 기존 결과 보존, 동시 저장 4개의 고유 이름, 정상 저장 후 임시 파일 제거.
- 폴더 선택 취소 및 존재하지 않는 폴더에 쓰기 실패 시 각도/사진/스티커 유지 후 저장 재시도. 저장 이후 수정 상태 복귀.
- 손상된 이미지 거부, renderer에 Node 및 raw IPC 없음, 창 보안 설정 확인, 잘못된 저장 타입/ID/추가 필드/다른 sender·iframe·URL 거부. 번들 프로토콜의 경로 접근 제한.
- orientation=6 JPG를 60×40 → 40×60으로 한 번 회전하고 픽셀 방향 및 PNG의 EXIF 부재 확인.
- Electron context를 offline으로 설정한 상태에서 열기/편집/저장 수행. 네이티브 대화상자의 선택 결과만 테스트에서 대체했다. Canvas, IPC와 디스크 I/O는 실제 구현이다.

초기 실패와 수정: 구현 전 모듈 부재로 테스트 실패를 확인했다. lint 2건을 수정했다. Electron 45 실행 바이너리를 별도 설치했다. 제한된 실행 환경에서 GUI가 SIGABRT로 종료되어 GUI 실행 권한으로 재실행했다(앱 자체 sandbox는 유지). 마우스 좌표 오차는 축소 화면의 물리 픽셀 양자화로 확인하여 UI 테스트에 화면 2px 상당 허용 오차를 적용했고, 출력 픽셀 비교는 정확 일치를 유지했다.

## 남은 검증·제한

- Windows NSIS 빌드/설치/실제 GUI, Windows DPI/한글·긴 경로/권한 거부/NTFS 저장은 미실행이다. Windows 장비에서 후속 검증이 필요하다. 설치 파일을 만들거나 배포하지 않았다.
- `dev`/`start`의 시작 로그를 확인했지만, 개발 모드 수동 편집과 OS native 대화상자 직접 조작은 별도 확인 대상이다. production 번들 전체 경로는 E2E에서 실행했다.
- 최대 허용 크기에서 장시간 메모리 측정, 디스크 가득 참/중간 쓰기 실패/임시 파일 삭제 자체 실패, EXIF 2~5/7/8과 ICC 색상 관리는 아직 검증하지 않았다. 실패 처리의 대표 경로는 존재하지 않는 출력 폴더로 검증했다.
- 가로 PNG와 EXIF 세로 JPG는 검증했고, 투명 사진 자체의 alpha/반투명 스티커/모든 경계의 안티앨리어싱은 아직 별도 fixture로 검증하지 않았다.
- 출력 형식은 PNG만 지원한다. 라이브러리·다중 사진·프로젝트 저장·미저장 경고는 구현하지 않았다. 앱을 닫으면 편집은 사라진다.
