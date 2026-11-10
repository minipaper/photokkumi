# 기본 스티커 (0.1.4)

사용자 요청(2026-11-10): 사용자가 제공한 `animal-direction-stickers.zip`(고양이·토끼·양·너구리 × 7방향, 512×512 투명 PNG 28장)을 앱 기본 스티커로 배포. 사용자 스티커를 저장소·릴리스에 넣지 않는다는 AGENTS.md 원칙의 **명시적 요청에 의한 예외**다. 원본 zip은 커밋하지 않는다. 그림은 사용자가 ChatGPT 이미지 생성으로 만들었고 README 하단에 그 사실을 적었다.

## 구성
- `resources/default-stickers/manifest.json`: `{ pack, stickers: [{ file, name, category }] }`. 이름은 한글(`고양이 정면`, `토끼 왼쪽 반측면` …), 분류는 `animal`.
- 패키징: electron-builder `extraResources`로 `resources/default-stickers` → 설치 폴더 `resources/default-stickers`(asar 밖).
- 개발 실행은 저장소의 `resources/default-stickers`를 쓴다. 개발/E2E에서만 `PHOTOKKUMI_DEFAULT_STICKERS=<폴더>` 또는 `none`(끄기)으로 바꿀 수 있고, 기존 E2E와 README 스크린샷은 `none`으로 빈 라이브러리에서 시작한다.

## 동작
- 라이브러리를 읽은 직후 `prefs.json`의 `defaultStickers`(이미 넣은 팩 번호, 기본 0)보다 manifest `pack`이 크면 한 번 추가하고 팩 번호를 기록한다. 새 설치와 0.1.3 이하에서 업데이트한 경우 모두 한 번 들어온다.
- 사용자 등록과 같은 검증·정규화(디코드 후 PNG 재인코딩)·해시 중복 판정을 거쳐 앱 관리 복사본(`stickers/<id>.png`)으로 들어간다. 이후에는 일반 스티커와 같다(이름·분류·즐겨찾기 변경, 삭제, 백업).
- 지운 기본 스티커는 다시 시작해도 돌아오지 않는다. 같은 그림이 이미 있으면 건너뛰고, 라이브러리 한도(100개)를 넘는 만큼은 넣지 않는다(오류 없음).
- 읽기 실패 등은 기본 스티커만 건너뛰고(다음 시작 때 재시도) 사용자 라이브러리에는 영향이 없다.
- 기본 스티커를 바꾸거나 더 넣으려면 파일·manifest를 고치고 `pack`을 올린다. 기존 사용자에게는 새 그림만 추가된다.

## 검증
- 단위 `tests/defaults.test.ts`: 팩 1회 추가·삭제 후 미복원, 해시 중복 건너뛰기, 100개 한도, 경로 탈출/형식 오류 거부, 실제 manifest↔파일 일치.
- E2E: 첫 실행에 `고양이 정면` 등 노출 → 삭제 → 재시작 후에도 없음.
- Windows 설치본에서 실제로 들어오는지는 사용자 확인 대기.
