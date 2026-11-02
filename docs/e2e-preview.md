# Windows 프리뷰 픽셀 비교 실패 수정

사용자가 Windows에서 설치한 앱의 사진·스티커 열기, 회전, 크기 조절, 저장이 정상임을 보고했다. E2E는 9개 중 8개 통과, 첫 테스트의 프리뷰 비교만 실패했다. Windows 버전/DPI/Node 상세와 설치 파일 생성 과정은 확인하지 않았으므로 전체 Windows GUI/패키징 완료로 간주하지 않는다.

실패한 지점은 (370, 300)이며, 저장 PNG는 예상 배경색 `[20, 40, 200, 255]` 검사를 통과했다. 프리뷰에서 읽은 `[0, 161, 255, 255]`는 설치된 Konva Transformer의 기본 borderStroke와 일치한다. 기존 Canvas는 사진/스티커뿐 아니라 선택 테두리도 함께 그렸다. 또한 `fill()` 완료 직후의 `evaluate()`는 Konva가 예약한 animation frame의 완료를 보장하지 않는다. 선택 UI 또는 이전 프레임을 사진 픽셀로 비교할 수 있는 테스트였다.

수정:

- 사진/스티커 Layer와 Transformer Layer를 분리했다. 각 native Canvas에 테스트 식별자를 달아 `.first()`의 순서 의존성을 제거했다.
- 실제 저장 결과의 색·크기·SHA-256 검증은 유지하고, 사진 Layer만 비교한다. `expect.poll()`로 실제 Canvas가 그려진 상태를 확인한다. 고정 sleep이나 넓은 색상 오차를 추가하지 않았다.
- 선택 테두리 위치인 (360, 300)도 표본으로 추가해 같은 문제가 되돌아오는지 검사한다.
- native 프로젝트 9개 외에 Electron의 `--force-device-scale-factor=1`, `=2`로 픽셀 테스트를 각각 실행한다. 실제 devicePixelRatio도 확인한다. 총 11개다.

실제 검증 환경은 macOS 26.3 arm64다. 수정 전 macOS 배율 1에서는 기존 테스트가 통과하여 Windows 실패를 직접 재현한 것은 아니다. 사용자 실패 로그와 Konva 기본색, 레이어 구성을 근거로 수정했다. 수정 후 기본 9개와 배율 1·2 테스트 총 11개가 통과했다. 단위/파일 I/O 21개, typecheck, lint, build, diff 공백 검사도 통과했다.

Windows에서 `npm run test:e2e`를 다시 실행해야 최종 확인된다. test-results는 계속 gitignore 대상으로 둔다.

참고: [Playwright expect.poll](https://playwright.dev/docs/test-assertions#expectpoll), [Konva Transformer](https://konvajs.org/docs/select_and_transform/Basic_demo.html).
