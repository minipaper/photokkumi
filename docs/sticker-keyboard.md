# 선택 스티커 키보드 조작과 회전 커서

범위: 단일 사진 편집에서 Delete/Backspace로 선택 배치 삭제, 방향키로 원본 기준 1px 이동, Shift+방향키로 10px 이동, 회전 핸들 hover 시 원형 화살표 커서. 단계 C의 다중 사진은 포함하지 않는다.

계획·검증: 실제 Electron E2E로 키보드 이동 실패를 재현한 뒤 기존 편집 상태/undo 경로에 연결한다. 입력 포커스 보호, 삭제·이동의 undo/redo, 저장 픽셀과 커서 진입/이탈을 검증하고 전체 회귀·타입·lint·빌드를 수행한다.

결정:

- 캔버스를 클릭하면 캔버스로 포커스를 옮긴다. 입력/선택 상자·contenteditable·종료 대화상자, 처리 중 및 조합 입력에서는 스티커 단축키를 무시한다. Ctrl/Meta/Alt 조합도 가로채지 않는다.
- 키보드 이동은 원본 좌표로 적용하며 각 keydown이 한 undo 작업이다. 삭제 키의 자동 반복은 무시하여 다음 선택 배치까지 연속 삭제하지 않는다.
- 회전 커서는 Konva의 기존 `rotateAnchorCursor` 설정으로 제공한다. 앱에 내장한 SVG data URL이며 사용자 SVG 입력을 허용하지 않는다. 외부 네트워크·의존성을 추가하지 않는다. 공식 API: https://konvajs.org/api/Konva.Transformer.html#rotateAnchorCursor

검증 결과(macOS 개발 환경):

- `npm test`: 39개 통과.
- `npm run test:e2e`: 15개 전체 통과(17.3초). 기존 14개와 새 키보드·커서 테스트 1개다. 1px/10px 양방향 이동, undo/redo, 입력 중 삭제 방지, 회전 커서 진입/이탈, 이동 후 PNG 픽셀, Delete/Backspace 삭제·undo, 선택 없음, 종료 대화상자 보호, 삭제 키 자동 반복 억제를 확인했다.
- `npm run typecheck`, `npm run lint`, `npm run build`, `git diff --check`: 통과.
- 실패 재현: 구현 전 방향키 입력 후 X가 600에서 601로 바뀌지 않는 E2E 실패를 확인했다. 테스트 보완 중 레이아웃 변경 후 좌표를 다시 구하고 종료 대화상자의 표시/닫힘과 실제 캔버스 재선택을 기다리도록 수정했다.
- Windows: 키보드 조작 변경 후 1 worker로 E2E 15개 전체 통과한 사용자 로그를 확인했다. 키보드 삭제·이동·입력 보호·회전 커서 테스트도 포함한다. 총 실행 시간과 정확한 OS/Node/npm 버전은 이번 로그에 없다. 설치본 수동 조작·패키징 검증은 대기다. 의존성 변경은 없다.

실행 문제 보고: 사용자 Windows에서 `npm ci` 후 `npm run dev` 시 빌드는 성공했지만 `Error: Electron uninstall`이 발생했다. 로컬 electron-vite의 실행 파일 경로 검사와 Electron 패키지 설치 방식을 확인했다. `npx --no-install install-electron --no` 후 개발 앱을 재실행하도록 안내한다. 이후 사용자가 개발 앱 실행 성공을 보고하여 해결을 확인했다.

사용자 수동 확인: 개발 앱 실행과 Delete/Backspace 삭제 성공. 방향키 입력 시 중심 X/Y 값도 정상 변경되며 Shift 이동으로 시각적 이동을 확인했다. 큰 사진을 축소 표시해 원본 1px 이동이 화면에서 매우 작게 보인 경우였다. 키보드 입력 오류 수정은 필요하지 않아 진단용 미완성 테스트는 제거했다. 설치본 검증과는 구분한다.
