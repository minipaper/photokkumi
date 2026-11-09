# 설치 파일 배포 (GitHub Releases)

`.github/workflows/release.yml`: `v*` 태그를 푸시하면 GitHub Actions의 Windows 서버에서 빌드한다.

1. `package.json`의 `version`을 올리고 커밋·푸시한다(예: `0.1.1`).
2. 태그를 만든다: `git tag v0.1.1 && git push origin v0.1.1` (태그와 version이 다르면 빌드가 실패한다).
3. Actions가 `npm ci → typecheck → lint → 단위 테스트 → Windows E2E → electron-builder(NSIS x64)` 순서로 실행하고, 설치 파일을 **임시 저장(draft) Release**에 붙인다.
4. 저장소 → Releases에서 draft를 열어 설치 파일을 내려받아 확인한 뒤 **Publish release**를 누르면 공개된다. 공개 전에는 다른 사람에게 보이지 않는다.

- 태그가 없는 평소 푸시는 아무것도 빌드하지 않는다.
- 같은 태그로 다시 실행하면 draft의 파일만 교체한다.
- E2E가 실패하면 설치 파일을 만들지 않고, 결과(`test-results/`)를 Actions 아티팩트로 7일 보관한다. 러너에 ffmpeg가 없어 GIF E2E는 건너뛴다.
- 코드 서명 없음: 첫 실행 시 Windows SmartScreen 경고("추가 정보 → 실행")가 뜬다. 서명·자동 업데이트·macOS dmg는 설정하지 않았다.
