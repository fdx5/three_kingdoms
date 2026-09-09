import { BALANCE } from '../data/balance';

/**
 * 이 기기가 무엇을 감당하는가 — 화질 관련 판단이 모두 여기 모인다.
 *
 * Renderer 에 두었더니 순환 참조가 생겼다(Renderer -> BattlePostFx -> Renderer).
 * 판정 자체는 렌더러를 몰라도 되는 순수 함수들이므로 따로 세운다.
 */

/**
 * 이 기기에 **메모리 안전장치**를 걸어야 하는가.
 *
 * 여기서 걸리면 안티에일리어싱이 꺼지고, 픽셀 비율이 1.5로 묶이고, 그림자 맵이
 * 2048로 눌린다. 프레임이 아니라 **할당**을 지키는 장치다 — 느린 것은 3초 실측이
 * 잡아 내리지만(main.ts updateFps), 메모리가 모자라 컨텍스트가 날아가면 잴 기회조차 없다.
 *
 * 예전 판정에는 버그가 둘 있었고 둘 다 화면을 흐리게 만드는 쪽으로 틀렸다.
 *
 *   1) `nav.deviceMemory ?? 4` 뒤에 `mem <= 4` 였다. deviceMemory 는 크로뮴에만
 *      있으므로 **사파리와 파이어폭스는 전부 4로 읽혀 저사양으로 떨어졌다.**
 *      맥북이든 아이패드 프로든 예외 없이 픽셀 비율 1.5에 안티에일리어싱이 꺼졌다.
 *      값이 없으면 "모른다"이지 "적다"가 아니다.
 *   2) userAgent 에 iPad 와 Mobile 이 들어 있었다. 태블릿은 폰이 아니다 — 화면이
 *      크고 GPU 도 다르다. 게다가 iPadOS 13 부터 사파리는 자신을 Macintosh 로
 *      보고하므로 /iPad/ 는 요즘 아이패드에 아예 걸리지도 않는다.
 *      아이패드를 알아보려면 Macintosh 이면서 터치가 되는지를 봐야 한다.
 *
 * 지금은 **진짜 폰**과 코어·메모리가 실제로 모자란 기기만 잡는다.
 * 태블릿과 데스크톱은 온전한 화질로 시작하고, 못 버티면 실측이 내려 준다.
 */
export function detectLowEnd(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const ua = nav.userAgent;
  const cores = nav.hardwareConcurrency ?? 4;
  const mem = nav.deviceMemory;
  // Android 는 폰일 때만 UA 에 Mobile 이 붙는다 (태블릿에는 없다).
  const phone = /iPhone|iPod|Windows Phone/i.test(ua) || /Android.*Mobile/i.test(ua);
  if (phone) return true;
  // 값이 있을 때만 믿는다. 2GB 이하면 4096 그림자 맵(67MB)이 위험하다.
  if (mem !== undefined && mem <= 2) return true;
  return cores <= 2;
}

/**
 * 손가락으로 쓰는 큰 화면인가 — 아이패드와 안드로이드 태블릿.
 *
 * iPadOS 사파리는 자신을 Macintosh 로 보고하므로 UA 만으로는 데스크톱과 구별되지
 * 않는다. 터치 포인트가 여럿인 Macintosh 는 아이패드다(맥에는 터치스크린이 없다).
 */
export function isTablet(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const touch = navigator.maxTouchPoints ?? 0;
  if (/iPad/i.test(ua)) return true;
  if (/Macintosh/i.test(ua) && touch > 1) return true;
  return /Android/i.test(ua) && !/Mobile/i.test(ua);
}

/**
 * iOS·iPadOS 인가 — **메모리 상한이 다른 기기**다.
 *
 * 데스크톱 브라우저는 그래픽 메모리가 모자라면 느려지거나 컨텍스트를 잃고 만다.
 * iOS 는 다르다. 한도를 넘으면 **탭을 통째로 죽인다** — 사용자는 흰 화면과
 * "문제가 반복적으로 발생했습니다"를 본다. 복구할 기회도, 자동 보정이 프레임을
 * 잴 기회도 없다. 그래서 이 기기들만은 성능이 아니라 **할당량**으로 판단한다.
 *
 * iPadOS 13 부터 사파리는 자신을 Macintosh 로 보고하므로 UA 만으로는 맥과
 * 구별되지 않는다. 터치가 되는 Macintosh 는 아이패드다(맥에는 터치스크린이 없다).
 */
export function isAppleTouchDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
}

/**
 * 이 기기가 감당할 그림자 맵의 한 변 — '높음'의 4096 을 저사양에서 눌러 준다.
 *
 * 프리셋과 따로 두는 이유: 프레임이 느려지는 것과 **할당이 실패하는 것**은 다르다.
 * 4096 x 4096 깊이 맵 하나가 67MB 다. 느린 것은 위의 실측이 3초 안에 잡아 내리지만,
 * 메모리가 모자라 컨텍스트가 날아가면 fps 를 잴 기회조차 없다 — 화면이 검게 남는다.
 * 그래서 이쪽만은 짐작이 아니라 보수적으로 간다. 2048 은 같은 맵의 1/4(17MB)이고,
 * 위에서 내려다보는 이 카메라 거리에서는 4096 과 눈으로 구별되지 않는다.
 */
export function maxShadowMapSize(): number {
  return detectLowEnd() || isAppleTouchDevice() ? 2048 : 4096;
}

/**
 * 이 기기가 감당할 픽셀 비율의 상한.
 *
 * 아이패드가 여기 걸리는 이유는 성능이 아니라 메모리다. 픽셀 비율 2는 프레임버퍼
 * 넓이를 네 배로 만들고, 그 위에 후처리의 HDR 버퍼와 MSAA 가 얹힌다.
 * 그림자 맵까지 더하면 iOS 의 탭 한도를 넘어 사파리가 탭을 죽인다.
 * 1.5 로 묶으면 넓이가 그 56% 가 되고, 레티나 화면에서 눈으로는 구별되지 않는다.
 */
export function maxPixelRatio(): number {
  return detectLowEnd() || isAppleTouchDevice() ? 1.5 : BALANCE.presets.high.maxDpr;
}
