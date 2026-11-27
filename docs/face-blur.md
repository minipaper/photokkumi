# 얼굴 자동 가리기 (0.1.14)

사용자 요청(2026-11-27)으로 `가림` 탭 맨 위에 `☺ 얼굴 자동 가리기` 버튼을 넣었다. 대상은 **사람 얼굴만**이다(번호판·글자는 범위 밖, 사용자 결정).

## 결정

- **모델**: OpenCV Zoo의 YuNet `face_detection_yunet_2026may.onnx`(MIT, 229,738B, SHA-256 `ebafce4e…22f0f0`, 입력 크기 가변). 약 10~300px 얼굴을 찾으며 단체 사진에 강하다.
- **런타임**: `onnxruntime-web` 1.31.1(MIT, 정확 버전 고정). `onnxruntime-web/wasm` 번들 + `ort-wasm-simd-threaded.wasm`(14.8MB)을 앱에 포함하며, 렌더러 Web Worker에서 단일 스레드로 돌린다(crossOriginIsolated 불필요). 1분 동안 쓰지 않으면 워커를 닫아 메모리를 돌려준다.
- **제외한 후보**: MediaPipe Tasks Vision은 번들 안에 Google 서버(`odml.pa.googleapis.com`)로 로그를 보내는 코드가 있어 외부 추적 금지 원칙에 걸리고, 단체 사진에 약하다. Chromium `FaceDetector`는 실험 기능이라 언제 사라질지 모르고 OS마다 품질이 다르다. SCRFD/InsightFace(비상업)·YOLO-face(AGPL)는 라이선스로 제외.
- **라이선스 고지(사용자 승인)**: 학습 데이터 WIDER FACE는 비상업 연구 조건으로 배포된다. 포토꾸미는 비상업 무료 앱이고 모델 가중치만 MIT로 포함하며 데이터셋은 포함하지 않는다는 점을 README와 `src/renderer/public/models/NOTICE.md`에 적었다. 모델·런타임 라이선스 원문은 같은 폴더에 함께 넣는다.
- **설치 파일 증가(사용자 승인)**: 약 15MB(압축 전). 0.1.14 설치 파일은 `onnxruntime-web`이 `dependencies`에 있어 electron-builder가 패키지 전체(145MB, 쓰지 않는 WASM 변형 포함)를 asar에 넣어 26MB 커졌다(143.6→169.8MB). 렌더러는 Vite가 필요한 파일만 번들하므로 `devDependencies`로 옮겼고, 패키징한 asar에 `node_modules/onnxruntime*`가 없고 wasm·모델은 들어 있음을 확인했다(다음 릴리스부터 적용).
- **처리**: 지금 보이는(회전·기울기 적용) 사진을 긴 변 1600px 이하로 줄이고 32의 배수로 채움 → BGR 0~255 NCHW → YuNet 12개 출력을 OpenCV `FaceDetectorYN`과 같은 방식으로 해석(점수 √(cls·obj), 중심 (열+dx)·stride, 크기 e^log·stride) → NMS(IoU 0.3) → 원본 좌표로 되돌려 얼굴보다 가로 1.3배·세로 1.4배 큰 타원 가림 영역. 점수 기준은 OpenCV 기본 0.9보다 낮은 **0.6**: 놓친 얼굴이 잘못 잡힌 상자보다 나쁘고, 잘못 잡힌 것은 지우면 된다.
- **편집**: 지금 고른 방식(블러/모자이크)·강도로 한 번에 추가하고 **실행 취소 1단계**. 이미 가린 영역 안에 중심이 있는 얼굴은 건너뛰어 다시 눌러도 겹치지 않는다. 한 사진 최대 50곳 제한을 지킨다. 못 찾으면 안내만 하고 사진을 수정 상태로 바꾸지 않는다.

## 보안 (AGENTS.md 3장 범위 안의 CSP 변경, 사용자 승인 2026-11-27)

- 페이지 CSP: `script-src 'self' 'wasm-unsafe-eval'`(WebAssembly 컴파일만 허용, JS `eval`은 계속 금지 — `'unsafe-eval'` 없음), `connect-src 'none'` → `'self'`(앱 번들 파일만 읽기). 다른 출처는 모두 차단된다.
- 워커는 페이지 CSP를 물려받지 않으므로 `app://bundle`의 JS 응답에 같은 제한의 CSP 헤더(`default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'`)를 붙인다.
- 프로토콜은 `.onnx`를 `/models/`에서만, `.wasm`을 빌드 `/assets/`에서만 내준다. 라이선스 원문 등 그 밖의 파일은 403.
- 사진은 렌더러 안에서만 처리하고 IPC·네트워크로 보내지 않는다.

## 검증

- 단위 `tests/faces.test.ts` 6개: 입력 크기(1600px·32 배수·작은 사진 유지), 출력 해석 공식, 점수 기준·클램프·NMS, 출력 형식 오류, NMS 순서·최대 50개, 얼굴 → 타원 영역 변환과 패딩·너무 작은 상자 제외. `tests/text.test.ts`에 모델·wasm 경로 제한.
- E2E `얼굴 자동 가리기: …`: **직접 그린 얼굴**(실제 인물 사진은 커밋하지 않음) 두 개를 오프라인에서 찾아 모자이크 2곳, 다시 누르면 추가 없음, 저장 픽셀(눈 위치 모자이크·하늘 그대로), undo 1단계, 원본 SHA-256 불변, 얼굴 없는 사진은 안내만·수정 표시 없음. 보안 E2E에 CSP 문자열, 외부 fetch가 `connect-src` 위반으로 막힘, 워커 JS의 CSP 헤더, 모델 MIME·LICENSE 403.
- 실제 사진(로컬 확인만, 저장소에 넣지 않음): OpenCV 샘플 `messi5.jpg` 1명(91%), `lena.jpg` 1명(91%), NASA 공개 단체 사진 Apollo 11 승무원 3명 전원(94%), STS-135 승무원 4명 전원(82~89%). 3840px 사진 120~170ms(Node, M 계열 Mac, 단일 스레드).
- 패키징 확인: macOS로 패키징한 앱(asar)을 오프라인으로 실행해 그린 얼굴 2곳을 1.3초(엔진 첫 로딩 포함) 안에 가림, 콘솔 오류 없음. Windows CI의 E2E도 통과.
- 미확인: Windows 설치본에서의 실제 속도, SIMD 미지원 구형 CPU, 수십 명이 작게 나온 단체 사진의 누락률.
