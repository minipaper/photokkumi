# 앱 아이콘 (2026-11-09)

- 원본 초안: 사용자 제공 `photokkumi_icon.png`(2048px). 변환 후 원본은 사용자 요청으로 삭제하고 저장소에는 `build/icon.png`·`build/icon.ico`만 둠. 회색 배경과 그림자가 불투명하게 칠해져 있고 타일이 가운데 약 58%만 차지해, 그대로 쓰면 작업 표시줄에 회색 네모가 보이고 아이콘이 작아짐.
- `npm run icon -- <원본.png>`가 `build/icon.png`(1024)와 `build/icon.ico`(16·24·32·48·64·128·256, PNG 압축 항목)를 만듦.
  - 모서리가 이미 투명한 원본이면 그대로 정사각형으로 맞춰 축소.
  - 이번 초안처럼 불투명한 2048px 원본은 측정한 둥근 타일(좌 426·우 1622·상 404·하 1662, 모서리 반경 250)만 4×4 슈퍼샘플링 마스크로 잘라 투명 배경으로 만들고, 위아래 3% 여백을 둠. 축소는 premultiplied 면적 평균.
- 적용: electron-builder `directories.buildResources = build`, `win.icon = build/icon.ico` → 설치 파일·exe·작업 표시줄 아이콘. 개발 실행(`npm run dev`)은 창 아이콘(Windows)과 Dock 아이콘(macOS)에 `build/icon.png`를 지정.
- 한계: 16·24px에서는 사진 속 풍경이 뭉개져 별·하트 색만 보임. 최종 디자인 때 작은 크기 전용 단순화 버전(사진 생략, 별·하트 크게)을 따로 받으면 `.ico`의 16~32px 항목만 교체하는 것을 권장.
- 미검증: Windows 실제 설치 파일·작업 표시줄에서의 표시(패키징 미실행).
