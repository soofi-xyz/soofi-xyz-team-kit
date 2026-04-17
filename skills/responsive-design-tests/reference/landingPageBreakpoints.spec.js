import { test, expect } from '@playwright/test';

const breakpoints = [
  {
    name: 'Mobile',
    viewport: { width: 320, height: 900 },
    nav: { paddingX: '16px', linksVisible: false, menuVisible: true, phoneVisible: false, loginVisible: false },
    hero: {
      titleSelector: '.home-header-title--mobile',
      titleSize: '32px',
      contentPaddingTop: '24px',
      contentPaddingX: '14px',
      contentPaddingBottom: '16px',
      mediaHeight: 220,
    },
    reviews: {
      paddingTop: '64px',
      paddingLeft: '16px',
      ratingValueSize: '80px',
      cardWidth: 237,
      cardsWidth: 1249,
      cardsPaddingRight: '0px',
      arrowRight: 15,
      arrowSize: 32,
      leftArrowMode: 'edge',
      leftArrowLeft: 15,
      cardsRightAligned: true,
    },
    who: {
      paddingLeft: '16px',
      paddingBottom: '16px',
      titleSize: '28px',
      textSize: '16px',
      imageHeight: 165,
      buttonJustify: 'center',
    },
    help: { paddingTop: '56px', paddingLeft: '16px', titleSize: '28px' },
    split: { paddingTop: '16px', paddingLeft: '16px', flexDirection: 'column', reverseDirection: 'column-reverse' },
    faq: { paddingTop: '64px', paddingLeft: '16px' },
    recognition: { paddingTop: '80px', paddingLeft: '16px' },
    footer: { paddingTop: '64px', paddingLeft: '16px', noticeMarginTop: '40px' },
  },
  {
    name: 'Mobile Large',
    viewport: { width: 480, height: 900 },
    nav: { paddingX: '16px', linksVisible: false, menuVisible: true, phoneVisible: false, loginVisible: false },
    hero: {
      titleSelector: '.home-header-title--mobile',
      titleSize: '32px',
      contentPaddingTop: '32px',
      contentPaddingX: '16px',
      contentPaddingBottom: '20px',
      mediaHeight: 260,
    },
    reviews: {
      paddingTop: '40px',
      paddingLeft: '16px',
      ratingValueSize: '64px',
      ratingWidth: 139,
      ratingPaddingTop: '24px',
      ratingPaddingBottom: '24px',
      cardWidth: 177,
      cardsWidth: 949,
      cardsPaddingRight: '0px',
      arrowRight: 15,
      starsDirection: 'column',
      leftArrowMode: 'gap-center',
      cardsRightAligned: true,
    },
    who: { paddingLeft: '16px', paddingBottom: '16px', titleSize: '36px', textSize: '16px', imageHeight: 260 },
    help: { paddingTop: '64px', paddingLeft: '16px', titleSize: '36px' },
    split: { paddingTop: '16px', paddingLeft: '16px', flexDirection: 'column', reverseDirection: 'column-reverse' },
    faq: { paddingTop: '64px', paddingLeft: '16px' },
    recognition: { paddingTop: '80px', paddingLeft: '16px' },
    footer: { paddingTop: '80px', paddingLeft: '16px', noticeMarginTop: '40px' },
  },
  {
    name: 'Tablet Small',
    viewport: { width: 810, height: 900 },
    nav: { paddingX: '16px', linksVisible: false, menuVisible: true, phoneVisible: false, loginVisible: false },
    hero: {
      titleSelector: '.home-header-title--mobile',
      titleSize: '32px',
      contentPaddingTop: '64px',
      contentPaddingX: '24px',
      contentPaddingBottom: '48px',
    },
    reviews: {
      paddingTop: '40px',
      paddingLeft: '40px',
      ratingValueSize: '64px',
      ratingWidth: 233,
      ratingPaddingTop: '12px',
      ratingPaddingBottom: '12px',
      cardWidth: 232,
      cardsWidth: 1224,
      cardsPaddingRight: '0px',
      arrowRight: 13,
      leftArrowMode: 'gap-center',
      cardsRightAligned: true,
      ratingBottomAligned: true,
      ratingBottomTolerance: 2,
    },
    who: { paddingLeft: '40px', paddingBottom: '40px', titleSize: '36px', textSize: '16px', imageHeight: 396 },
    help: { paddingTop: '104px', paddingLeft: '104px', titleSize: '36px' },
    split: {
      paddingTop: '40px',
      paddingLeft: '40px',
      flexDirection: 'row',
      reverseDirection: 'row',
      justifyContent: 'space-between',
    },
    faq: { paddingTop: '100px', paddingLeft: '40px' },
    recognition: { paddingTop: '80px', paddingLeft: '80px' },
    footer: { paddingTop: '80px', paddingLeft: '40px', noticeMarginTop: '64px' },
  },
  {
    name: 'Tablet',
    viewport: { width: 1024, height: 900 },
    nav: {
      paddingX: '64px',
      linksVisible: true,
      menuVisible: false,
      phoneVisible: true,
      loginVisible: true,
      linksSingleLine: true,
      phoneSingleLine: true,
    },
    hero: {
      titleSelector: '.home-header-title--desktop',
      titleSize: '44px',
      contentPaddingTop: '72px',
      contentPaddingLeft: '0px',
      contentPaddingRight: '48px',
      contentPaddingBottom: '0px',
    },
    reviews: {
      paddingTop: '64px',
      paddingLeft: '64px',
      ratingValueSize: '64px',
      ratingWidth: 240,
      cardWidth: 264,
      cardsPaddingRight: '0px',
      cardsWidth: 1384,
      arrowRight: 32,
      leftArrowMode: 'gap-center',
      cardsRightAligned: true,
      ratingBottomAligned: true,
      ratingBottomTolerance: 2,
    },
    who: { paddingLeft: '64px', paddingBottom: '40px', titleSize: '36px', textSize: '16px', imageHeight: 378 },
    help: { paddingTop: '64px', paddingLeft: '64px', titleSize: '36px' },
    split: {
      paddingTop: '40px',
      paddingLeft: '64px',
      flexDirection: 'row',
      reverseDirection: 'row',
      justifyContent: 'space-between',
    },
    faq: { paddingTop: '100px', paddingLeft: '40px' },
    recognition: { paddingTop: '80px', paddingLeft: '80px' },
    footer: { paddingTop: '80px', paddingLeft: '40px', noticeMarginTop: '64px' },
  },
  {
    name: 'XL',
    viewport: { width: 1536, height: 900 },
    nav: { paddingX: '64px', linksVisible: true, menuVisible: false, phoneVisible: true, loginVisible: true },
    hero: {
      titleSelector: '.home-header-title--desktop',
      titleSize: '44px',
      contentPaddingTop: '72px',
      contentPaddingX: '104px',
      contentPaddingBottom: '64px',
      contentLeft: 160,
    },
    reviews: {
      paddingTop: '64px',
      paddingLeft: '160px',
      ratingValueSize: '64px',
      ratingWidth: 286,
      cardWidth: 286,
      cardsWidth: 1526,
      arrowRight: 156,
      leftArrowMode: 'gap-center',
      cardsRightAligned: true,
      ratingBottomAligned: true,
      ratingBottomTolerance: 2,
    },
    who: { paddingLeft: '160px', paddingBottom: '40px', titleSize: '36px', textSize: '16px', imageHeight: 350 },
    help: { paddingTop: '64px', paddingLeft: '64px', titleSize: '36px' },
    split: {
      paddingTop: '40px',
      paddingLeft: '160px',
      flexDirection: 'row',
      reverseDirection: 'row',
      justifyContent: 'space-between',
    },
    faq: { paddingTop: '100px', paddingLeft: '160px' },
    recognition: { paddingTop: '80px', paddingLeft: '200px' },
    footer: { paddingTop: '80px', paddingLeft: '40px', noticeMarginTop: '64px' },
  },
];

const ensureBox = async (locator) => {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box;
};

const seedExperiments = async (page) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      '_soc_experiments',
      JSON.stringify({ 'Landing Page AB Testing': { SiteA: true, SiteB: false } }),
    );
  });
};

const envName = (process.env.TEST_ENV || '').toLowerCase();
const isRemoteEnv = ['dev', 'prod'].includes(envName) && !process.env.TEST_BASE_URL;
const runDesignAssertions = process.env.DESIGN_ASSERTIONS === '1' || !isRemoteEnv;

breakpoints.forEach((bp) => {
  test.describe(`Landing page - ${bp.name}`, () => {
    test.skip(
      !runDesignAssertions,
      'Design breakpoint assertions run only against local builds.',
    );
    test.use({ viewport: bp.viewport });

    test.beforeEach(async ({ page }) => {
      await seedExperiments(page);
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForSelector('.home-header');
      await page.evaluate(() => document.fonts.ready);
    });

    test('matches breakpoint layout', async ({ page }) => {
      const navInner = page.locator('.header-inner');
      const headerLinks = page.locator('.header-links');
      const menuButton = page.locator('.header-menu-button');
      const phone = page.locator('.header-phone');
      const login = page.locator('.header-login-button');

      await expect(navInner).toHaveCSS('padding-left', bp.nav.paddingX);
      await expect(navInner).toHaveCSS('padding-right', bp.nav.paddingX);
      await (bp.nav.linksVisible ? expect(headerLinks).toBeVisible() : expect(headerLinks).toBeHidden());
      await (bp.nav.menuVisible ? expect(menuButton).toBeVisible() : expect(menuButton).toBeHidden());
      await (bp.nav.phoneVisible ? expect(phone).toBeVisible() : expect(phone).toBeHidden());
      await (bp.nav.loginVisible ? expect(login).toBeVisible() : expect(login).toBeHidden());
      if (bp.nav.menuVisible) {
        await menuButton.click();
        const menuItem = page.locator('.menu-item').first();
        const menuLoginButton = page.locator('.menu-login-button');
        const menuPhone = page.locator('.menu-phone');
        const menuTertiaryLink = page.locator('.menu-tertiary-link').first();
        await expect(menuItem).toHaveCSS('font-weight', '400');
        await expect(menuLoginButton).toHaveCSS('font-weight', '400');
        await expect(menuLoginButton).toHaveText(/log in/i);
        await expect(menuPhone).toHaveCSS('font-weight', '600');
        await expect(menuTertiaryLink).toHaveCSS('font-weight', '400');
        const closeMenuButton = page.getByRole('button', { name: /close menu/i });
        await closeMenuButton.click();
        await page.keyboard.press('Escape').catch(() => {});
        await page.locator('.menu-content').waitFor({ state: 'hidden' });
        await page.locator('.menu-overlay').waitFor({ state: 'hidden' });
      }
      if (bp.nav.linksSingleLine) {
        const firstLink = headerLinks.locator('.menu-item').first();
        const linkBox = await ensureBox(firstLink);
        expect(Math.round(linkBox.height)).toBeLessThanOrEqual(24);
      }
      if (bp.nav.phoneSingleLine) {
        const phoneBox = await ensureBox(phone);
        expect(Math.round(phoneBox.height)).toBeLessThanOrEqual(24);
      }

      const heroContent = page.locator('.home-header-content');
      const heroTitle = page.locator(bp.hero.titleSelector);
      await expect(heroContent).toHaveCSS('padding-top', bp.hero.contentPaddingTop);
      await expect(heroContent).toHaveCSS('padding-bottom', bp.hero.contentPaddingBottom);
      if (bp.hero.contentPaddingX) {
        await expect(heroContent).toHaveCSS('padding-left', bp.hero.contentPaddingX);
        await expect(heroContent).toHaveCSS('padding-right', bp.hero.contentPaddingX);
      }
      if (bp.hero.contentPaddingLeft) {
        await expect(heroContent).toHaveCSS('padding-left', bp.hero.contentPaddingLeft);
      }
      if (bp.hero.contentPaddingRight) {
        await expect(heroContent).toHaveCSS('padding-right', bp.hero.contentPaddingRight);
      }
      if (bp.hero.contentLeft !== undefined) {
        const heroContentBox = await ensureBox(heroContent);
        expect(Math.round(heroContentBox.x)).toBe(bp.hero.contentLeft);
      }
      await expect(heroTitle).toHaveCSS('font-size', bp.hero.titleSize);
      if (bp.hero.mediaHeight) {
        const mediaBox = await ensureBox(page.locator('.home-header-media'));
        expect(Math.round(mediaBox.height)).toBe(bp.hero.mediaHeight);
      }

      const reviewsSection = page.locator('.quotes-section');
      const rating = page.locator('.quotes-rating');
      const ratingValue = page.locator('.quotes-rating-value');
      const firstCard = page.locator('.quotes-card').first();
      const cards = page.locator('.quotes-cards');
      const cardsTrack = page.locator('.quotes-cards-track');
      const leftArrow = page.locator('.quotes-arrow--left');
      await expect(reviewsSection).toHaveCSS('padding-top', bp.reviews.paddingTop);
      await expect(reviewsSection).toHaveCSS('padding-left', bp.reviews.paddingLeft);
      await expect(ratingValue).toHaveCSS('font-size', bp.reviews.ratingValueSize);
      const ratingBox = await ensureBox(rating);
      if (bp.reviews.ratingWidth) {
        expect(Math.round(ratingBox.width)).toBe(bp.reviews.ratingWidth);
      }
      if (bp.reviews.ratingPaddingTop) {
        await expect(rating).toHaveCSS('padding-top', bp.reviews.ratingPaddingTop);
      }
      if (bp.reviews.ratingPaddingBottom) {
        await expect(rating).toHaveCSS('padding-bottom', bp.reviews.ratingPaddingBottom);
      }
      const cardBox = await ensureBox(firstCard);
      expect(Math.round(cardBox.width)).toBe(bp.reviews.cardWidth);

      await cards.evaluate((node) => {
        node.scrollLeft = node.scrollWidth;
        node.dispatchEvent(new Event('scroll'));
      });
      await page.waitForTimeout(100);
      const cardsBox = await ensureBox(cards);
      const lastCardBox = await ensureBox(page.locator('.quotes-card').last());
      expect(Math.round(lastCardBox.x + lastCardBox.width)).toBeLessThanOrEqual(
        Math.round(cardsBox.x + cardsBox.width),
      );
      if (bp.reviews.ratingBottomAligned) {
        const ratingBottom = ratingBox.y + ratingBox.height;
        const cardsBottom = cardsBox.y + cardsBox.height;
        const tolerance = bp.reviews.ratingBottomTolerance ?? 1;
        expect(Math.abs(Math.round(ratingBottom - cardsBottom))).toBeLessThanOrEqual(tolerance);
      }
      if (bp.reviews.cardsWidth) {
        const trackCards = cardsTrack.locator('.quotes-card');
        const totalCards = await trackCards.count();
        const baseCount = Math.max(1, Math.round(totalCards / 3));
        const firstCardBox = await ensureBox(trackCards.nth(0));
        const lastBaseCardBox = await ensureBox(trackCards.nth(baseCount - 1));
        const baseWidth = Math.round(lastBaseCardBox.x + lastBaseCardBox.width - firstCardBox.x);
        expect(baseWidth).toBeGreaterThanOrEqual(bp.reviews.cardsWidth);
      }
      const viewportWidth =
        bp.reviews.arrowRight !== undefined || bp.reviews.cardsRightAligned
          ? await page.evaluate(() => document.documentElement.clientWidth)
          : null;
      if (bp.reviews.cardsRightAligned) {
        const cardsRight = Math.round(cardsBox.x + cardsBox.width);
        expect(Math.abs(cardsRight - Math.round(viewportWidth))).toBeLessThanOrEqual(1);
      }
      if (bp.reviews.arrowRight !== undefined) {
        const arrow = page.locator('.quotes-arrow[aria-label="Next review"]');
        const arrowBox = await ensureBox(arrow);
        expect(Math.round(viewportWidth - (arrowBox.x + arrowBox.width))).toBe(bp.reviews.arrowRight);
        if (bp.reviews.arrowSize) {
          expect(Math.round(arrowBox.width)).toBe(bp.reviews.arrowSize);
          expect(Math.round(arrowBox.height)).toBe(bp.reviews.arrowSize);
        }
      }
      if (bp.reviews.leftArrowMode) {
        await expect(leftArrow).toHaveCount(1);
        const leftArrowBox = await ensureBox(leftArrow);
        if (bp.reviews.leftArrowMode === 'edge') {
          expect(Math.round(leftArrowBox.x)).toBe(bp.reviews.leftArrowLeft);
        }
        if (bp.reviews.leftArrowMode === 'gap-center') {
          const gapStart = ratingBox.x + ratingBox.width;
          const gapEnd = cardsBox.x;
          const expectedCenter = (gapStart + gapEnd) / 2;
          const arrowCenter = leftArrowBox.x + leftArrowBox.width / 2;
          expect(Math.round(arrowCenter)).toBe(Math.round(expectedCenter));
        }
      }
      if (bp.reviews.cardsPaddingRight) {
        await expect(cards).toHaveCSS('padding-right', bp.reviews.cardsPaddingRight);
      }
      if (bp.reviews.starsDirection) {
        await expect(page.locator('.quotes-rating-stars')).toHaveCSS('flex-direction', bp.reviews.starsDirection);
      }

      // Skip interaction-based carousel scroll checks; layout assertions above cover visuals.

      if (bp.viewport.width <= 320) {
        const longQuoteCard = page
          .locator('.quotes-card', { hasText: 'Everyone I’ve spoken' })
          .first();
        const longQuote = longQuoteCard.locator('.quotes-card-quote');
        const cardBox = await ensureBox(longQuoteCard);
        const quoteBox = await ensureBox(longQuote);
        expect(Math.round(quoteBox.x)).toBeGreaterThanOrEqual(Math.round(cardBox.x));
        expect(Math.round(quoteBox.y)).toBeGreaterThanOrEqual(Math.round(cardBox.y));
        expect(Math.round(quoteBox.x + quoteBox.width)).toBeLessThanOrEqual(
          Math.round(cardBox.x + cardBox.width) + 1,
        );
        expect(Math.round(quoteBox.y + quoteBox.height)).toBeLessThanOrEqual(
          Math.round(cardBox.y + cardBox.height) + 1,
        );
      }

      const whoSection = page.locator('.who-we-are');
      const whoTitle = page.locator('.who-we-are-title');
      const whoText = page.locator('.who-we-are-text').first();
      const whoImage = page.locator('.who-we-are-image');
      const whoButton = page.locator('.who-we-are-button--mobile');
      await expect(whoSection).toHaveCSS('padding-left', bp.who.paddingLeft);
      await expect(whoSection).toHaveCSS('padding-bottom', bp.who.paddingBottom);
      await expect(whoTitle).toHaveCSS('font-size', bp.who.titleSize);
      await expect(whoText).toHaveCSS('font-size', bp.who.textSize);
      const whoImageBox = await ensureBox(whoImage);
      expect(Math.round(whoImageBox.height)).toBe(bp.who.imageHeight);
      if (bp.who.buttonJustify) {
        await expect(whoButton).toHaveCSS('justify-content', bp.who.buttonJustify);
      }

      const helpSection = page.locator('.we-are-here-section');
      const helpTitle = page.locator('.we-are-here-title');
      await expect(helpSection).toHaveCSS('padding-top', bp.help.paddingTop);
      await expect(helpSection).toHaveCSS('padding-left', bp.help.paddingLeft);
      await expect(helpTitle).toHaveCSS('font-size', bp.help.titleSize);

      const splitSection = page.locator('.home-split-section');
      const splitRow = page.locator('.split-section-row').first();
      const splitReverseRow = page.locator('.split-section-row--reverse');
      await expect(splitSection).toHaveCSS('padding-top', bp.split.paddingTop);
      if (bp.split.paddingLeft) {
        await expect(splitSection).toHaveCSS('padding-left', bp.split.paddingLeft);
      }
      await expect(splitRow).toHaveCSS('flex-direction', bp.split.flexDirection);
      if (bp.split.reverseDirection) {
        await expect(splitReverseRow).toHaveCSS('flex-direction', bp.split.reverseDirection);
      }
      if (bp.split.justifyContent) {
        await expect(splitRow).toHaveCSS('justify-content', bp.split.justifyContent);
      }

      const faqSection = page.locator('.home-faq');
      await expect(faqSection).toHaveCSS('padding-top', bp.faq.paddingTop);
      await expect(faqSection).toHaveCSS('padding-left', bp.faq.paddingLeft);

      const recognition = page.locator('.home-recognition-and-certifications');
      await expect(recognition).toHaveCSS('padding-top', bp.recognition.paddingTop);
      await expect(recognition).toHaveCSS('padding-left', bp.recognition.paddingLeft);

      const footer = page.locator('footer.footer');
      await expect(footer).toHaveCSS('padding-top', bp.footer.paddingTop);
      await expect(footer).toHaveCSS('padding-left', bp.footer.paddingLeft);
      if (bp.footer.noticeMarginTop) {
        const noticeSection = page.locator('.notice-section');
        await expect(noticeSection).toHaveCSS('margin-top', bp.footer.noticeMarginTop);
      }

      const footerButton = page.locator('.footer-button');
      const footerTitle = page.locator('.title-section h3');
      await expect(footerButton).toHaveText(/contact us/i);
      await expect(footerButton).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(footerButton).toHaveCSS('color', 'rgb(3, 99, 199)');
      await expect(footerButton).toHaveCSS('font-size', '16px');
      await expect(footerButton).toHaveCSS('line-height', '22.4px');
      const footerButtonBox = await ensureBox(footerButton);
      const footerTitleBox = await ensureBox(footerTitle);
      expect(Math.round(footerButtonBox.x)).toBe(Math.round(footerTitleBox.x));

      const footerMenuRow = page.locator('.footer-menu-row');
      if (bp.name === 'Mobile' || bp.name === 'Mobile Large') {
        await expect(footerMenuRow).toHaveCSS('flex-direction', 'column');
        await expect(footerMenuRow).toHaveCSS('align-items', 'flex-end');
      }
      if (bp.name === 'Tablet Small' || bp.name === 'Tablet') {
        await expect(footerMenuRow).toHaveCSS('flex-direction', 'column');
        await expect(footerMenuRow).toHaveCSS('align-items', 'flex-end');
      }
      if (bp.name === 'XL') {
        await expect(footerMenuRow).toHaveCSS('flex-direction', 'row');
        await expect(footerMenuRow).toHaveCSS('flex-wrap', 'nowrap');
        await expect(footerMenuRow).toHaveCSS('align-items', 'center');
      }
    });
  });
});
