# 단계 A 안정화 계획

범위는 하드 링크 미지원 저장, 의존성 감사 분석, Windows 검증 절차, 미저장 종료 확인이다. 라이브러리·다중 사진·자동 저장/복구는 추가하지 않는다.

1. 미지원 파일시스템의 저장과 파일명 경합, 중간 쓰기 실패·정리 테스트를 먼저 작성하고 실패를 확인한다. 완성된 임시 파일 + 하드 링크의 원자적 확정을 우선하고, 미지원 오류에만 최종 파일 `wx` 독점 생성·쓰기·fsync·실패 정리로 대체한다. 일반 rename은 기존 파일을 교체할 수 있어 사용하지 않는다.
2. 종료 요청을 main에서 차단하고 renderer의 최신 상태로 저장·버리기·취소를 판단한다. 저장 성공 후에만 닫기를 허용한다. 작업 중 닫기, 실패·취소, 재요청을 Electron에서 검증한다.
3. audit JSON의 실제 advisory ID와 경로를 구분하고, production dependencies 및 bundle 포함 여부, 안전한 패치 가능성을 조사한다.
4. 현재 OS와 Windows 실행 수단을 확인하고, 불가능하면 PowerShell 명령과 수동 체크리스트를 기록한다. 패키징 성공과 GUI 완료는 별개로 보고한다.

검증: Vitest 실제 임시 파일 + fs 오류 주입, Playwright 실제 Electron/Canvas/IPC/I/O, typecheck/lint/build, diff 공백/민감값 점검.

## 저장 방식과 안전성

| 방식 | 기존 파일/원본 보호 | 확정/실패 동작 |
| --- | --- | --- |
| 기존 하드 링크 | 대상이 존재하면 EEXIST. 검사 후 쓰기 경합 없음 | fsync한 완성 임시 파일을 한 번에 노출. 하드 링크가 없으면 실패 |
| 이번 폴백: 최종 이름 `wx` open → 쓰기 → 크기 확인 → fsync → close | 독점 생성 자체로 경합 차단. EEXIST면 다음 suffix. 기존 파일은 열거나 삭제하지 않음 | 쓰는 동안 최종 이름의 부분 파일이 보일 수 있음. 실패하면 핸들을 닫고 생성 당시 dev/ino와 현재 파일이 같은 경우에만 삭제 |
| 일반 rename 교체 | 운영체제에 따라 기존 대상 교체 가능 | 이 앱에서는 채택하지 않음 |
| `copyFile(COPYFILE_EXCL)` | 덮어쓰기 방지는 가능 | Node는 원자적 복사를 보장하지 않으며 실패 시 정리를 시도함. 이번에는 독점 핸들·fsync·정리 오류를 직접 관리할 수 있는 `wx`를 선택 |

`ENOTSUP/EOPNOTSUPP/ENOSYS/EXDEV/EPERM/EACCES`처럼 링크를 사용할 수 없는 경우에만 폴백한다. EACCES/EPERM이라도 새 파일 독점 생성 권한이 없으면 저장은 실패하며 오류를 숨기지 않는다. EIO 등 일반 I/O 오류는 폴백하지 않는다. 임시 파일은 같은 폴더에 만들고 모든 정상 종료 경로에서 정리한다.

부분 출력 삭제의 EPERM/EBUSY는 짧게 2회 재시도한다. 삭제 권한까지 없어지거나 파일 정체성을 확인할 수 없는 상황에는 완전한 정리를 보장할 수 없다. 성공으로 보고하지 않고 정리 대상 파일명과 실패를 안내하며 편집을 유지한다. 다른 프로세스가 실패 파일을 교체했다면 타인의 파일을 삭제하지 않는다. 프로세스 강제 종료/전원 중단에서는 폴백 부분 파일이나 임시 파일이 남을 수 있다. 자동 복구는 이번 범위 밖이다.

참고: [Node 24 fs 문서](https://nodejs.org/docs/latest-v24.x/api/fs.html)의 open wx, FileHandle.sync, copyFile 보장을 기준으로 한다. 실제 exFAT/FAT 장치가 아닌 fs.link 오류 주입으로 미지원 상황을 재현했다.

## 미저장 종료 보호

이전 구현에는 종료 경고가 없었다. 현재 main은 사진 세션 또는 진행 중 작업이 있으면 창 닫기와 `app.quit`를 먼저 보류하고, 한 번만 유효한 nonce를 renderer에 보낸다. renderer는 현재 dirty/busy 상태를 사용한다.

- 미저장 상태: 모달에서 저장·버리기·취소. 기본 포커스와 Escape는 취소이며 저장 중에는 조작을 잠근다.
- 저장: 같은 PNG 합성/검증/파일 저장 API를 사용한다. 결과 파일이 확정된 후에만 닫는다. 실패/폴더 취소는 보류한 종료 요청 자체를 취소하고 편집과 창을 유지한다.
- 버리기: 출력 파일 없이 닫기. 취소: 창 유지. 저장된 사진/미수정 사진은 경고 없이 닫는다.
- 작업 중 닫기: 작업 완료까지 대기한 뒤 최신 dirty 상태로 결정한다. 반복 닫기·앱 종료 요청으로 중복 모달/중복 저장을 만들지 않는다.
- main은 종료 응답의 sender/frame/URL, 객체 필드/action, 현재 요청 nonce를 검증한다. preload는 종료 요청 구독/응답 기능만 추가하며 raw IPC를 노출하지 않는다.

[BrowserWindow close](https://www.electronjs.org/docs/latest/api/browser-window#event-close)와 [app before-quit](https://www.electronjs.org/docs/latest/api/app#event-before-quit) 기반이다. OS 강제 종료, renderer crash, 로그아웃/전원 상실을 저장·복구로 처리하지 않는다.

## 실제 검증

환경: macOS 26.3 arm64, npm 11.11.1, npm 스크립트 Node 24.22.2, Electron 45.2.1. 합성 fixture만 임시 폴더에 생성했다.

| 명령 | 결과 |
| --- | --- |
| `npm test` | 3 파일, 21 테스트 통과 |
| `npm run test:e2e` | 실제 Electron 9 테스트 통과, build 포함 |
| `npm run typecheck`, `npm run lint` | 통과 |
| `npm run build` | E2E 사전 빌드로 main/preload/renderer 통과 |
| `npm audit --json` | 고유 advisory 1개 / moderate 패키지 항목 25개 |
| `npm audit --omit=dev --json` | 0건 |
| `npm audit fix --dry-run --ignore-scripts --json` | advisory/25개 항목 유지. 실제 변경 없음 |
| `git diff --check`, 새 파일별 공백 검사 | 통과 |

저장 테스트: 링크 미지원 6종, 8개 동시 저장, 다른 writer의 결정적 이름 선점, 최종 파일 writeFile/sync/close 오류 후 정리, 일반 EIO 전파, 일시적 삭제 잠금 재시도, 다른 writer가 교체한 파일 보존, 지속 삭제 거부 안내. 원본/기존 파일 보존과 잔여 임시 파일을 실제 디스크에서 확인했다. 실패 재현을 먼저 확인한 뒤 구현했다.

Electron 회귀: 기존 이동·크기·회전·원본 크기 픽셀/투명도/clipping·SHA-256·EXIF·offline·IPC 검증을 유지했다. 창 닫기 취소/저장 폴더 취소/저장 실패 후 현재 각도 유지와 성공 시 닫기, 앱 종료 취소·버리기 및 실제 프로세스 종료, 작업 중 닫기 보류, 하드 링크 미지원+부분 쓰기 실패 정리와 재시도를 추가했다. native 파일 대화상자의 선택 결과와 일부 fs 오류만 주입하고 main/preload/renderer·Canvas·파일 I/O는 실제 실행했다. 최초 E2E의 종료 요청이 그대로 닫히는 실패를 확인한 뒤 보호를 구현했다.

## 감사와 Windows

[의존성 감사 분석](./dependency-audit.md)에 advisory/중복 경로/영향/배포 포함 여부/수정 보류 근거를 기록했다. [Windows 검증 절차](./windows-validation.md)에 PowerShell 실행 명령과 짧은 수동 체크리스트, 결과 기록 양식을 제공했다.

Windows 테스트/NSIS 빌드/설치/GUI는 현재 환경에서 실행하지 못했다. macOS E2E 성공과 Windows 패키징·GUI 완료를 구분한다. 실제 FAT/exFAT 장치, Windows DPI/권한/긴 경로, 강제 종료와 전원 중단은 미검증이다. 라이브러리·다중 사진·자동 저장/복구는 추가하지 않았다.
