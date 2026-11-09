# GIF 만들기 (2026-11-09)

## 흐름
- 툴바 `사진 편집 | GIF 만들기` 탭으로 모드를 바꾼다. 두 모드의 상태는 서로 유지된다(사진 편집 중 GIF로 갔다 와도 편집 그대로).
- ffmpeg가 없으면 설치 안내 카드: Windows `winget install Gyan.FFmpeg`(macOS `brew install ffmpeg`) 명령을 복사해 설치 → `다시 찾기`. 또는 `ffmpeg 위치 선택`으로 실행 파일 지정(`userData/tools.json`에 기억).
- 동영상(MOV/MP4/M4V)은 `동영상 열기` 또는 끌어 놓기. 사진 모드에서 동영상을 놓아도 GIF 모드로 바뀌어 열린다. 한 번에 하나만 열고 나머지는 제외 안내.
- 타임라인: 썸네일 띠 위에서 `[` `]` 핸들 드래그, 클릭/드래그로 재생 위치, 키보드 `[` 시작 지정, `]` 끝 지정, Space 구간 반복 재생, ←/→ 프레임(Shift 1초), Home/End. 시작·끝은 수치(0.1초)로도 입력.
- 너비 320/480/640/800(원본보다 크게 만들지 않음), FPS 8~24. 길이·프레임 수·결과 크기를 표시하고 10초 초과 시 용량 경고.
- `GIF로 저장` → 진행률·취소. 출력 폴더는 사진 저장과 같은 폴더를 공유(미지정이면 선택). `<원본이름>_kkumi.gif`, 충돌 시 숫자, 기존 파일·원본 덮어쓰기 없음.

## 라이선스 결정 (사용자 승인)
- ffmpeg를 **설치 파일에 포함하지 않는다**. 앱은 자동 다운로드·설치도 하지 않고 안내만 한다. 사용자가 직접 설치한 ffmpeg를 별도 프로세스로 실행하므로 ffmpeg 재배포에 따른 GPL/LGPL 의무가 생기지 않는다는 판단(법률 자문 아님).

## 보안 결정 (AGENTS.md 3장 예외)
- 외부 프로세스는 ffmpeg 하나만, `spawn(path, args, { shell: false })`로 실행한다. 인자는 `shared/gif.ts`의 고정 배열이며 렌더러 문자열이 그대로 들어가지 않는다(옵션은 허용 목록·범위 검증 후 숫자만 사용).
- 실행 전 `ffmpeg -version` 출력이 `ffmpeg version`으로 시작하는지 확인한다. 아니면 저장하지 않는다.
- 렌더러는 경로를 모른다. 동영상은 대화상자/드롭으로 main이 받은 경로를 내부 ID로 매핑하고(일반 파일·확장자·4GB 이하, symlink 거부), 렌더러는 ID만 보낸다.
- 시간 제한(정보 30초, 미리보기 180초, GIF 600초)과 출력 크기 제한(미리보기 96MB, GIF 200MB), 창을 닫으면 작업 종료. GIF는 임시 폴더에 만든 뒤 `GIF89a` 헤더를 확인하고 기존 저장 로직(`saveUnique`)으로 확정, 임시 파일은 항상 삭제.
- 검색 위치: PATH의 `ffmpeg`, winget Links·Packages, Program Files, `C:\ffmpeg\bin`, scoop, chocolatey, macOS Homebrew. 테스트용 `PHOTOKKUMI_FFMPEG_CANDIDATES`는 패키징되지 않은 빌드에서만 읽는다.

## 미리보기
- HEVC를 Chromium이 재생하지 못해도 되도록 ffmpeg로 640px JPEG 프레임을 뽑아 보여 준다. 최대 300프레임(짧은 영상 10fps, 긴 영상은 낮춤). ffmpeg가 회전 메타데이터를 적용하므로 세로 아이폰 영상은 세로로 나온다.
- GIF는 `palettegen(stats_mode=diff)` + `paletteuse(bayer 5, diff_mode=rectangle)` 2단계 팔레트, lanczos 축소, 무한 반복.

## 검증 (macOS 26.3 arm64, ffmpeg 8.0.1)
- 단위 8개: 옵션 검증·프레임 계산·30초 경계, 미리보기 FPS, 인자 배열(공백·한글 경로 그대로, 업스케일 방지), ffmpeg 출력에서 길이·회전 크기, MJPEG 분리·진행률, 동영상 등록 검증, 미설치·가짜 ffmpeg 거부, Windows 후보 경로.
- E2E 1개: 후보 없음 → 안내 카드·다시 찾기 실패·가짜 파일 거부·실제 ffmpeg 지정 → 재실행 후 기억 → 사진 모드에서 **90° 회전 HEVC MOV** 드롭 → GIF 모드 전환·240×320 인식 → 키보드 `[` `]`·핸들 드래그·수치 입력 → GIF 저장(헤더 GIF89a, 240×320, 20프레임) → 다시 저장 시 `_1` → 원본 SHA-256 불변 → 사진 모드 복귀. ffmpeg가 없는 환경에서는 이 E2E를 건너뛴다.
- 미검증: Windows에서 winget 설치 직후 탐지, 실제 아이폰 영상(긴 영상·고해상도)의 미리보기 시간과 GIF 용량.
