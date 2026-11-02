# 단계 A 의존성 감사

안정화 작업에서 `npm audit --json`, `npm audit --omit=dev --json`, `npm ls minimatch --all`, `npm ls --omit=dev --all`, `npm view`와 `npm audit fix --dry-run --ignore-scripts --json`을 실제 실행했다. 강제 수정·검사 비활성화·advisory 제외를 하지 않았다. package.json 의존성 버전과 lockfile을 변경하지 않았다.

## 집계와 실제 취약점

- npm 전체 집계: moderate **25개 패키지 항목**, high/critical 0.
- `via` 객체의 `source`/URL을 중복 제거한 **고유 advisory는 1개**, minimatch의 실제 설치 위치는 **6개**, 버전은 4종이다. 나머지 패키지 이름은 같은 advisory의 영향 전파 항목이다. “서로 다른 취약점 25개”로 해석하면 안 된다.
- [GHSA-g3hv-75wg-m249 / CVE-2026-118764](https://github.com/advisories/GHSA-g3hv-75wg-m249): 악의적인 glob 패턴의 전처리가 CPU/메모리 소비를 증폭할 수 있다. advisory는 `<11.0.1`을 affected, `11.0.1`을 patched로 표시하며 설명의 구체적 조건은 `optimizationLevel >= 2`다. 사진 디코딩 취약점이나 파일 유출 취약점으로 보고된 것은 아니다.

| 설치된 minimatch | 경로(프로젝트 node_modules 아래) | 주요 유입 경로 / 사용처 |
| --- | --- | --- |
| 10.2.6 | `minimatch` | electron-builder → app-builder-lib, ESLint → config-array, typescript-eslint → typescript-estree; 빌드/lint 패턴 |
| 9.0.9 | `@electron/universal/node_modules/minimatch` | electron-builder → app-builder-lib → @electron/universal; macOS universal 병합 |
| 5.1.9 | `filelist/node_modules/minimatch` | builder → app-builder-lib → ejs → jake → filelist |
| 3.1.5 | `@electron/asar/node_modules/minimatch` | builder → app-builder-lib → @electron/asar; archive 패턴 |
| 3.1.5 | `glob/node_modules/minimatch` | builder → app-builder-lib → @electron/asar → glob |
| 3.1.5 | `dir-compare/node_modules/minimatch` | builder → app-builder-lib → @electron/universal → dir-compare |

집계 대상 25개 패키지: `minimatch`, `glob`, `@electron/asar`, `@electron/universal`, `dir-compare`, `filelist`, `jake`, `ejs`, `app-builder-lib`, `dmg-builder`, `electron-builder`, `electron-builder-squirrel-windows`, `electron-winstaller`, `rimraf`, `temp`, `eslint`, `@eslint/config-array`, `@eslint-community/eslint-utils`, `@eslint/js`, `typescript-eslint`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, `@typescript-eslint/type-utils`, `@typescript-eslint/typescript-estree`, `@typescript-eslint/utils`.

## 이 앱에서의 영향과 배포 포함 여부

- 위 6개 설치 위치는 모두 lockfile에서 `dev: true`다. `npm ls --omit=dev`의 정상 production 의존 그래프에 minimatch가 없고, 생성된 main/preload/renderer 번들에도 minimatch 참조가 없다.
- electron-builder의 production 수집 코드는 dependencies/optionalDependencies만 순회하고 devDependencies를 제외한다. 현재 앱은 빌드/lint 도구를 import하지 않는다. 따라서 **현재 구성상 minimatch는 설치된 앱의 실행 의존성에서 제외된다**. Windows 설치 파일을 실제 만들고 ASAR 내용을 확인한 결과는 아직 아니다. Windows 절차에 ASAR 확인을 포함했다.
- Electron 자체도 npm에서는 devDependency지만 Electron 실행 바이너리는 배포에 포함된다. 그러므로 “모든 devDependency는 배포와 무관”이라고 일반화하지 않는다. 이번 advisory의 대상은 Electron 바이너리가 아니라 빌드 도구에 딸린 minimatch다. `npm audit --omit=dev` 0건은 Electron/Chromium 자체 전체 보안 평가를 뜻하지 않는다.
- 확인한 app-builder-lib, @eslint/config-array, @electron/universal, typescript-estree 호출부는 `dot`/`matchBase` 등 옵션을 사용하고 `optimizationLevel: 2`를 지정하지 않는다. 설치된 minimatch 9/10 기본값은 1이다. 3/5에는 설명에 등장하는 `firstPhasePreProcess` 구현이 없다. **이 프로젝트의 현재 설정에서 공격 조건이 충족된다는 증거는 찾지 못했다**는 분석이며, advisory 범위를 임의로 수정하거나 취약점이 없다고 판정한 것은 아니다. 악성 패턴을 이용한 DoS 부하 실험은 하지 않았다.
- 남는 노출은 개발/CI에서 외부가 제공한 glob 설정을 처리하거나 해당 최적화를 사용하는 의존 도구가 추가되는 상황이다. 현재 사용자 사진·파일명은 glob 설정으로 전달하지 않는다.

## 수정 가능 여부와 결정

1. 공식 npm 조회에서 minimatch 최신은 11.0.3이고, 10 계열 최신은 설치된 10.2.6이다. ESLint 10.14.0은 `^10.2.6`을 요구하고 electron-builder 최신도 설치된 26.18.0이다. Node 24는 minimatch 11의 engines에 맞지만 호출 API 호환성과는 별개다.
2. [minimatch 11 변경 내역](https://github.com/isaacs/minimatch/blob/main/changelog.md)은 `makeRe`, `regexp`, `AST` 등 제거, `set` 원소 타입 및 패턴 의미 변경을 명시한다. 구버전 호출부 중 @electron/asar와 dir-compare는 기본 함수 export를 호출한다. 모든 3/5/9/10을 11로 일괄 override하면 함수 형태·타입·매칭 결과가 달라질 수 있어 안전한 패치로 간주하지 않았다.
3. `npm audit fix --dry-run --ignore-scripts --json`도 advisory 1개와 moderate 25개를 남겼다. 출력의 optional 플랫폼 패키지 추가/로컬 Node 설치 보조물 정리는 이 advisory의 수정이 아니다. 실제 `fix`는 실행하지 않았다.
4. audit의 일부 `fixAvailable`은 ESLint 4.0.0, electron-builder 20.23.1 등 호환되지 않는 major downgrade를 제안했다. 적용하지 않았다. 경고 제거만을 목적으로 패키징/검사 도구를 제거하거나 audit을 끄지 않았다.
5. 현재 결정: **미해결 1 advisory / 전파 항목 25개를 명시적으로 유지**. 상위 도구의 minimatch 11 지원 또는 호환되는 보안 backport가 나오면 해당 범위만 업데이트하고 lint·테스트·Windows 패키징·파일 포함 목록을 검증한다. 수동 backport/별도 fork는 이번 안정화에 추가하지 않았다.

참고: `npm ls --omit=dev`에 `node-bin-setup`이 extraneous로 보인다. 고정된 개발용 Node 패키지의 바이너리 설치 스크립트가 만든 로컬 보조 패키지이며 정상 production dependency 연결은 없다. 이 항목을 근거로 “minimatch 포함”으로 집계하지 않았다. Konva의 optional `canvas`/`skia-canvas`도 브라우저 Canvas를 쓰는 현재 renderer에는 설치하지 않았다.
