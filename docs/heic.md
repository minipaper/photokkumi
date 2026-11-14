# 아이폰 HEIC 사진 (0.1.11)

사용자 요청(2026-11-14): 아이폰 HEIC 사진이 열리지 않음. 크로미엄(Electron)에는 HEVC 이미지 해독기가 없고, Windows도 유료 HEVC 확장이 있어야 HEIC를 읽는다. 사용자가 다음을 골랐다.

- **해독기 앱 내장** — [libheif](https://github.com/strukturag/libheif)·[libde265](https://github.com/strukturag/libde265)(LGPL-3.0)의 WASM 빌드인 [libheif-js](https://github.com/catdad-experiments/libheif-js) 1.23.5(LGPL-3.0)를 고정 버전으로 넣는다. ffmpeg 방식은 ffmpeg가 없는 사용자가 못 쓰므로 고르지 않았다.
- **1,600만 화소 넘는 사진은 열 때 줄인다** — 요즘 아이폰 기본 HEIC는 5712×4284(2,400만 화소)라 사진 한도(1,600만 화소·한 변 8,192px)를 넘는다. 같은 모양으로 한도 안에 맞춘다(5712×4284 → 4618×3464). JPG 한도는 그대로다.

## 동작

- `.heic`/`.heif`를 열기 창·폴더·끌어 놓기에서 받는다. 확장자가 아니라 `ftyp` 상자의 HEVC 브랜드(`heic`·`heix`·`heim`·`heis`·`hevc`·`hevx`)로 판별한다. AVIF 등 다른 HEIF는 받지 않는다.
- main 프로세스가 사진마다 **새 worker thread**에서 해독한다(`src/main/heic-worker.ts`). 창이 멈추지 않고, 해독이 끝나면 worker를 끝내 WASM 메모리(사진당 수백 MB)를 돌려받는다. 해독 전 해상도가 5,000만 화소·한 변 16,384px를 넘으면 거부하고, 2분이 지나면 중단한다.
- libheif가 `irot`/`imir` 회전·뒤집기를 적용한 주 이미지를 BGRA로 받아 nativeImage로 줄이고 **JPEG 품질 95**로 바꾼다. 투명 HEIC는 PNG로 바꾼다.
- HEIC에 든 ICC 프로필(아이폰은 Display P3)을 JPEG의 APP2 `ICC_PROFILE`로 옮긴다. 그래서 편집기(크로미엄)가 아이폰 JPG처럼 sRGB로 색 변환해 그리고, 저장 결과의 색이 사진 앱에서 보던 것과 같다. 프로필을 옮기지 않으면 색이 바랜다.
- 변환본은 `userData/converted/<uuid>.jpg`에 두고 사진 전환 때 다시 해독하지 않는다. 목록에서 빼면 지우고, 앱 시작·종료 때 폴더째 지운다(단일 인스턴스). 원본은 읽기만 하며, 열 때마다 원본 SHA-256을 다시 확인한다. 변환본이 없어졌으면 원본에서 다시 만든다.
- 여러 장을 열 때 하단 상태줄에 `사진 불러오는 중… n/전체`를 보여 준다(`photo:progress`).
- 저장 이름은 원본 이름을 따른다(`IMG_0001.HEIC` → `IMG_0001_kkumi.jpg/png`). 결과에는 EXIF·위치 정보가 들어가지 않는다.

## 라이선스 처리 (LGPL-3.0)

- `libheif-js`는 main 번들에 합치지 않고 `node_modules` 그대로 두며, 설치 폴더의 `resources/app.asar.unpacked/node_modules/libheif-js/`에 **asar 밖 일반 파일**로 풀어 둔다(`asarUnpack`). 사용자가 같은 인터페이스의 다른 빌드로 바꿔 넣을 수 있다.
- LGPL 원문(`LICENSE`)이 같은 폴더에 함께 들어간다. README에 고지와 소스 위치를 적었다.
- 쓰지 않는 asm.js·별도 wasm·mjs 사본은 패키지에서 뺐다(약 6MB). 설치 폴더 증가는 약 2.1MB.
- HEVC에는 특허 풀이 있다. 무료 배포 앱에서 흔히 쓰는 해독기지만 위험이 0은 아니라고 사용자에게 알리고 내장을 결정했다.

## 검증

- 단위 `tests/heic.test.ts` 5개: 브랜드 판별(AVIF 거부), 화소 한도 맞춤, ICC APP2 조각(65,519바이트 분할), libheif 해독 BGRA·P3 프로필·2,400만 화소, PhotoStore 변환본 캐시·진행률·실패 제외·캐시 분실 재변환·제거.
- E2E `HEIC: …`: 합성 HEIC 3장(sRGB 96×64, Display P3 96×64, 5712×4284)을 열어 저장. 사분면 픽셀, P3 빨강이 sRGB에서 더 진해짐(R≥210·G≤52), 4618×3464 축소, 원본 SHA-256 불변, 목록에서 빼면 변환본 삭제, 종료 시 캐시 폴더 삭제.
- 픽스처는 `sips`로 만든 단색 사분면 HEIC(`tests/fixtures/quad-*.heic`)뿐이다. 사용자의 아이폰 사진은 저장소에 넣지 않았다.
- 실제 아이폰 HEIC 3장(3024×4032, 5712×4284 두 장): macOS 개발 빌드와 패키징한 앱(asar 밖 해독기)에서 3장 여는 데 3.6~5.3초, 변환 뒤 사진 전환 0.1초. 세로 방향과 색이 맞았다.
- 남은 확인: 실제 Windows에서 여는 속도와 메모리(Windows CI E2E로 해독·저장 픽셀은 확인).
