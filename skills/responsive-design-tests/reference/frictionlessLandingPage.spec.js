const { test, expect } = require('@playwright/test');

const shouldSkip = process.env.MOCK_API !== 'true';

const breakpoints = [
  {
    name: '1536',
    viewport: { width: 1536, height: 1350 }, // 1:4342
    header: {
      width: 1536,
      height: 67.5938,
      paddingTop: 16,
      paddingBottom: 16,
      paddingX: 48,
      borderColor: 'rgb(26, 32, 44)',
    }, // 1:4344
    logo: { type: 'full', width: 245, height: 43 }, // 1:4346 (42.72px)
    language: { size: 14, weight: 400, lineHeight: 19.6, color: 'rgb(128, 128, 128)' }, // 1:4388
    background: { color: 'rgb(241, 248, 255)', paddingTop: 80, paddingBottom: 30 }, // 1:4389
    progress: {
      width: 800,
      height: 50,
      paddingTop: 8,
      paddingBottom: 8,
      paddingX: 24,
      radius: 12,
      bg: 'rgb(0, 49, 114)',
    }, // 1:4390
    progressFill: { height: 8, bg: 'rgb(240, 240, 245)' }, // 1:4391
    dynamic: {
      width: 800,
      paddingTop: 48,
      paddingBottom: 65,
      paddingX: 102,
      radius: 12,
      gap: null,
    }, // 1:4392
    intro: {
      heading: { size: 40, weight: 600, lineHeight: 38, color: 'rgb(0, 60, 143)' }, // 1:4394
      subtitle: { size: 20, weight: 400, lineHeight: 26, color: 'rgb(108, 122, 147)' }, // 1:4395
      spacing: 16, // 1:4393
    },
    paymentLayout: { direction: 'column', buttonColumnWidth: null }, // 1:5234
    paymentAreaGap: 20, // 1:5233
    paymentMethodGap: 20, // 1:5234
    detailsGap: 16, // 1:5278
    paymentButton: {
      height: 50,
      paddingY: 9,
      paddingX: 13,
      radius: 12,
      borderColor: 'rgb(229, 242, 255)',
      shadow: 'rgba(16, 24, 40, 0.05) 0px 1px 2px 0px',
      fontSize: 16,
      lineHeight: 24,
      weight: 600,
      color: 'rgb(0, 60, 143)',
    }, // 1:5235
    planDetails: {
      padding: 17,
      radius: 12,
      borderColor: 'rgb(240, 247, 255)',
      shadow: 'rgba(16, 24, 40, 0.05) 0px 1px 2px 0px',
      heading: { size: 20, lineHeight: 24, weight: 600, color: 'rgb(0, 60, 143)' }, // 1:5286
      label: { size: 12, lineHeight: 18, weight: 400, color: 'rgb(108, 122, 147)' }, // 1:5289
      tag: {
        paddingY: 2,
        paddingX: 8,
        radius: 6,
        bg: 'rgb(229, 242, 255)',
        fontSize: 12,
        lineHeight: 18,
        weight: 400,
        color: 'rgb(5, 99, 199)',
      }, // 1:5283
      breakdown: { size: 16, lineHeight: 24, weight: 600, color: 'rgb(0, 60, 143)' }, // 1:5300
    },
    accountDetails: {
      padding: 16,
      radius: 12,
      borderColor: 'rgb(240, 247, 255)',
      shadow: 'rgba(16, 24, 40, 0.05) 0px 1px 2px 0px',
      heading: { size: 20, lineHeight: 30, weight: 600, color: 'rgb(0, 60, 143)' }, // 1:5305
      label: { size: 12, lineHeight: 18, weight: 400, color: 'rgb(108, 122, 147)' }, // 1:5308
      value: { size: 12, lineHeight: 18, weight: 600, color: 'rgb(108, 122, 147)' }, // 1:5309
    },
    credit: {
      width: 596,
      padding: 24,
      radius: 24,
      gap: 24,
      imageHeight: 160,
      textWidth: 312,
      bg: 'rgb(247, 252, 236)',
      layout: 'row',
      text: { size: 14, lineHeight: 16.8, weight: 400, color: 'rgb(0, 0, 0)' }, // 1:4439
    }, // 1:4437
    legalContainerGap: 30, // 1:4436
    legal: { size: 13, lineHeight: 18, color: 'rgb(137, 149, 169)', gap: 13 }, // 1:4441
    chat: { size: 60, right: 16, bottom: 305, bg: 'rgb(5, 99, 199)', radius: 60 }, // 1:4445
  },
  {
    name: '1280',
    viewport: { width: 1280, height: 1350 }, // 1:4448
    header: {
      width: 1280,
      height: 67.5938,
      paddingTop: 16,
      paddingBottom: 16,
      paddingX: 48,
      borderColor: 'rgb(26, 32, 44)',
    }, // 1:4450
    logo: { type: 'full', width: 245, height: 43 }, // 1:4452 (42.72px)
    language: { size: 14, weight: 400, lineHeight: 19.6, color: 'rgb(128, 128, 128)' }, // 1:4494
    background: { color: 'rgb(241, 248, 255)', paddingTop: 80, paddingBottom: 30 }, // 1:4495
    progress: {
      width: 800,
      height: 50,
      paddingTop: 8,
      paddingBottom: 8,
      paddingX: 24,
      radius: 12,
      bg: 'rgb(0, 49, 114)',
    }, // 1:4496
    progressFill: { height: 8, bg: 'rgb(240, 240, 245)' }, // 1:4497
    dynamic: {
      width: 800,
      paddingTop: 48,
      paddingBottom: 65,
      paddingX: 102,
      radius: 12,
      gap: null,
    }, // 1:4498
    intro: {
      heading: { size: 40, weight: 600, lineHeight: 38, color: 'rgb(0, 60, 143)' }, // 1:4500
      subtitle: { size: 20, weight: 400, lineHeight: 26, color: 'rgb(108, 122, 147)' }, // 1:4501
      spacing: 16, // 1:4499
    },
    paymentLayout: { direction: 'column', buttonColumnWidth: null }, // 1:5406
    paymentAreaGap: 20, // 1:5405
    paymentMethodGap: 20, // 1:5406
    detailsGap: 16, // 1:5450
    paymentButton: {
      height: 50,
      paddingY: 9,
      paddingX: 13,
      radius: 12,
      borderColor: 'rgb(229, 242, 255)',
      shadow: 'rgba(16, 24, 40, 0.05) 0px 1px 2px 0px',
      fontSize: 16,
      lineHeight: 24,
      weight: 600,
      color: 'rgb(0, 60, 143)',
    }, // 1:5407
    planDetails: {
      padding: 17,
      radius: 12,
      borderColor: 'rgb(240, 247, 255)',
      shadow: 'rgba(16, 24, 40, 0.05) 0px 1px 2px 0px',
      heading: { size: 20, lineHeight: 24, weight: 600, color: 'rgb(0, 60, 143)' }, // 1:5458
      label: { size: 12, lineHeight: 18, weight: 400, color: 'rgb(108, 122, 147)' }, // 1:5461
      tag: {
        paddingY: 2,
        paddingX: 8,
        radius: 6,
        bg: 'rgb(229, 242, 255)',
        fontSize: 12,
        lineHeight: 18,
        weight: 400,
        color: 'rgb(5, 99, 199)',
      }, // 1:5455
      breakdown: { size: 16, lineHeight: 24, weight: 600, color: 'rgb(0, 60, 143)' }, // 1:5472
    },
    accountDetails: {
      padding: 16,
      radius: 12,
      borderColor: 'rgb(240, 240, 245)',
      shadow: 'rgba(16, 24, 40, 0.05) 0px 1px 2px 0px',
      heading: { size: 20, lineHeight: 30, weight: 600, color: 'rgb(0, 60, 143)' }, // 1:5477
      label: { size: 12, lineHeight: 18, weight: 400, color: 'rgb(108, 122, 147)' }, // 1:5480
      value: { size: 12, lineHeight: 18, weight: 600, color: 'rgb(108, 122, 147)' }, // 1:5481
    },
    credit: {
      width: 596,
      padding: 24,
      radius: 24,
      gap: 24,
      imageHeight: 160,
      textWidth: 312,
      bg: 'rgb(247, 252, 236)',
      layout: 'row',
      text: { size: 14, lineHeight: 16.8, weight: 400, color: 'rgb(0, 0, 0)' }, // 1:4545
    }, // 1:4543
    legalContainerGap: 30, // 1:4542
    legal: { size: 13, lineHeight: 18, color: 'rgb(137, 149, 169)', gap: 13 }, // 1:4547
    chat: { size: 60, right: 16, bottom: 305, bg: 'rgb(5, 99, 199)', radius: 60 }, // 1:4551
  },
  {
    name: '1024',
    viewport: { width: 1024, height: 1350 }, // 1:4554
    header: {
      width: 1024,
      height: 67.5938,
      paddingTop: 16,
      paddingBottom: 16,
      paddingX: 48,
      borderColor: 'rgb(26, 32, 44)',
    }, // 1:4556
    logo: { type: 'full', width: 245, height: 43 }, // 1:4558 (42.72px)
    language: { size: 14, weight: 400, lineHeight: 19.6, color: 'rgb(128, 128, 128)' }, // 1:4600
    background: { color: 'rgb(241, 248, 255)', paddingTop: 80, paddingBottom: 30 }, // 1:4601
    progress: {
      width: 800,
      height: 50,
      paddingTop: 8,
      paddingBottom: 8,
      paddingX: 24,
      radius: 12,
      bg: 'rgb(0, 49, 114)',
    }, // 1:4602
    progressFill: { height: 8, bg: 'rgb(240, 240, 245)' }, // 1:4603
    dynamic: {
      width: 800,
      paddingTop: 48,
      paddingBottom: 65,
      paddingX: 102,
      radius: 12,
      gap: null,
    }, // 1:4604
    intro: {
      heading: { size: 40, weight: 600, lineHeight: 38, color: 'rgb(0, 60, 143)' }, // 1:4606
      subtitle: { size: 20, weight: 400, lineHeight: 26, color: 'rgb(108, 122, 147)' }, // 1:4607
      spacing: 16, // 1:4605
    },
    paymentLayout: { direction: 'column', buttonColumnWidth: null }, // 1:5578
    paymentAreaGap: 20, // 1:5577
    paymentMethodGap: 20, // 1:5578
    detailsGap: 16, // 1:5622
    paymentButton: {
      height: 50,
      paddingY: 9,
      paddingX: 13,
      radius: 12,
      borderColor: 'rgb(229, 242, 255)',
      shadow: 'rgba(16, 24, 40, 0.05) 0px 1px 2px 0px',
      fontSize: 16,
      lineHeight: 24,
      weight: 600,
      color: 'rgb(0, 60, 143)',
    }, // 1:5579
    planDetails: {
      padding: 17,
      radius: 12,
      borderColor: 'rgb(240, 240, 245)',
      shadow: 'rgba(16, 24, 40, 0.05) 0px 1px 2px 0px',
      heading: { size: 20, lineHeight: 24, weight: 600, color: 'rgb(0, 60, 143)' }, // 1:5630
      label: { size: 12, lineHeight: 18, weight: 400, color: 'rgb(108, 122, 147)' }, // 1:5633
      tag: {
        paddingY: 2,
        paddingX: 8,
        radius: 6,
        bg: 'rgb(229, 242, 255)',
        fontSize: 12,
        lineHeight: 18,
        weight: 400,
        color: 'rgb(5, 99, 199)',
      }, // 1:5627
      breakdown: { size: 16, lineHeight: 24, weight: 600, color: 'rgb(0, 60, 143)' }, // 1:5644
    },
    accountDetails: {
      padding: 16,
      radius: 12,
      borderColor: 'rgb(240, 240, 245)',
      shadow: 'rgba(16, 24, 40, 0.05) 0px 1px 2px 0px',
      heading: { size: 20, lineHeight: 30, weight: 600, color: 'rgb(0, 60, 143)' }, // 1:5649
      label: { size: 12, lineHeight: 18, weight: 400, color: 'rgb(108, 122, 147)' }, // 1:5652
      value: { size: 12, lineHeight: 18, weight: 600, color: 'rgb(108, 122, 147)' }, // 1:5653
    },
    credit: {
      width: 596,
      padding: 24,
      radius: 24,
      gap: 24,
      imageHeight: 160,
      textWidth: 312,
      bg: 'rgb(247, 252, 236)',
      layout: 'row',
      text: { size: 14, lineHeight: 16.8, weight: 400, color: 'rgb(0, 0, 0)' }, // 1:4651
    }, // 1:4649
    legalContainerGap: 30, // 1:4648
    legal: { size: 13, lineHeight: 18, color: 'rgb(137, 149, 169)', gap: 13 }, // 1:4653
    chat: { size: 60, right: 16, bottom: 305, bg: 'rgb(5, 99, 199)', radius: 60 }, // 1:4657
  },
  {
    name: '810',
    viewport: { width: 810, height: 1350 }, // 1:4660
    header: {
      width: 810,
      height: 67.5938,
      paddingTop: 16,
      paddingBottom: 16,
      paddingX: 48,
      borderColor: 'rgb(26, 32, 44)',
    }, // 1:4662
    logo: { type: 'full', width: 245, height: 43 }, // 1:4664 (42.72px)
    language: { size: 14, weight: 400, lineHeight: 19.6, color: 'rgb(128, 128, 128)' }, // 1:4706
    background: { color: 'rgb(241, 248, 255)', paddingTop: 80, paddingBottom: 30 }, // 1:4707
    progress: {
      width: 800,
      height: 50,
      paddingTop: 8,
      paddingBottom: 8,
      paddingX: 24,
      radius: 12,
      bg: 'rgb(0, 49, 114)',
    }, // 1:4708
    progressFill: { height: 8, bg: 'rgb(240, 240, 245)' }, // 1:4709
    dynamic: {
      width: 800,
      paddingTop: 48,
      paddingBottom: 65,
      paddingX: 102,
      radius: 12,
      gap: null,
    }, // 1:4710
    intro: {
      heading: { size: 40, weight: 600, lineHeight: 38, color: 'rgb(0, 60, 143)' }, // 1:4712
      subtitle: { size: 20, weight: 400, lineHeight: 26, color: 'rgb(108, 122, 147)' }, // 1:4713
      spacing: 16, // 1:4711
    },
    paymentLayout: { direction: 'column', buttonColumnWidth: null }, // 1:5320
    paymentAreaGap: 20, // 1:5319
    paymentMethodGap: 20, // 1:5320
    detailsGap: 16, // 1:5364
    paymentButton: {
      height: 50,
      paddingY: 9,
      paddingX: 13,
      radius: 12,
      borderColor: 'rgb(229, 242, 255)',
      shadow: 'rgba(16, 24, 40, 0.05) 0px 1px 2px 0px',
      fontSize: 16,
      lineHeight: 24,
      weight: 600,
      color: 'rgb(0, 60, 143)',
    }, // 1:5321
    planDetails: {
      padding: 17,
      radius: 12,
      borderColor: 'rgb(240, 247, 255)',
      shadow: 'rgba(16, 24, 40, 0.05) 0px 1px 2px 0px',
      heading: { size: 20, lineHeight: 24, weight: 600, color: 'rgb(0, 60, 143)' }, // 1:5372
      label: { size: 12, lineHeight: 18, weight: 400, color: 'rgb(108, 122, 147)' }, // 1:5375
      tag: {
        paddingY: 2,
        paddingX: 8,
        radius: 6,
        bg: 'rgb(229, 242, 255)',
        fontSize: 12,
        lineHeight: 18,
        weight: 400,
        color: 'rgb(5, 99, 199)',
      }, // 1:5369
      breakdown: { size: 16, lineHeight: 24, weight: 600, color: 'rgb(0, 60, 143)' }, // 1:5386
    },
    accountDetails: {
      padding: 16,
      radius: 12,
      borderColor: 'rgb(240, 240, 245)',
      shadow: 'rgba(16, 24, 40, 0.05) 0px 1px 2px 0px',
      heading: { size: 20, lineHeight: 30, weight: 600, color: 'rgb(0, 60, 143)' }, // 1:5391
      label: { size: 12, lineHeight: 18, weight: 400, color: 'rgb(108, 122, 147)' }, // 1:5394
      value: { size: 12, lineHeight: 18, weight: 600, color: 'rgb(108, 122, 147)' }, // 1:5395
    },
    credit: {
      width: 596,
      padding: 24,
      radius: 24,
      gap: 24,
      imageHeight: 160,
      textWidth: 312,
      bg: 'rgb(247, 252, 236)',
      layout: 'row',
      text: { size: 14, lineHeight: 16.8, weight: 400, color: 'rgb(0, 0, 0)' }, // 1:4757
    }, // 1:4755
    legalContainerGap: 30, // 1:4754
    legal: { size: 13, lineHeight: 18, color: 'rgb(137, 149, 169)', gap: 13 }, // 1:4759
    chat: { size: 60, right: 16, bottom: 305, bg: 'rgb(5, 99, 199)', radius: 60 }, // 1:4763
  },
  {
    name: '480',
    viewport: { width: 480, height: 1393 }, // 1:4766
    header: {
      width: 480,
      height: 51.5938,
      paddingTop: 8,
      paddingBottom: 8,
      paddingX: 16,
      borderColor: 'rgb(26, 32, 44)',
    }, // 1:4768
    logo: { type: 'icon', width: 36, height: 36 }, // 1:4802
    language: { size: 14, weight: 400, lineHeight: 19.6, color: 'rgb(128, 128, 128)' }, // 1:4812
    background: { color: 'rgb(251, 253, 255)', paddingTop: 0, paddingBottom: 0 }, // 1:4766
    progress: {
      width: 432,
      height: null,
      paddingTop: 32,
      paddingBottom: 32,
      paddingX: 24,
      radius: 12,
      bg: 'rgb(255, 255, 255)',
    }, // 1:4814
    progressFill: { height: 8, bg: 'rgb(242, 248, 254)' }, // 1:4815
    dynamic: {
      width: 480,
      paddingTop: 16,
      paddingBottom: 65,
      paddingX: 24,
      radius: 12,
      gap: null,
    }, // 1:4816
    intro: {
      heading: { size: 40, weight: 600, lineHeight: 38, color: 'rgb(0, 60, 143)' }, // 1:4818
      subtitle: { size: 20, weight: 400, lineHeight: 26, color: 'rgb(108, 122, 147)' }, // 1:4819
      spacing: 16, // 1:4817
    },
    paymentLayout: { direction: 'column', buttonColumnWidth: null }, // 1:5492
    paymentAreaGap: 20, // 1:5491
    paymentMethodGap: 20, // 1:5492
    paymentMethodHeight: 120, // 1:5492
    detailsGap: 16, // 1:5536
    paymentButton: {
      height: 50,
      paddingY: 9,
      paddingX: 13,
      radius: 12,
      borderColor: 'rgb(229, 242, 255)',
      shadow: 'rgba(16, 24, 40, 0.05) 0px 1px 2px 0px',
      fontSize: 16,
      lineHeight: 24,
      weight: 600,
      color: 'rgb(0, 60, 143)',
    }, // 1:5493
    planDetails: {
      padding: 17,
      radius: 12,
      borderColor: 'rgb(229, 242, 255)',
      shadow: 'rgba(16, 24, 40, 0.05) 0px 1px 2px 0px',
      heading: { size: 20, lineHeight: 24, weight: 600, color: 'rgb(0, 60, 143)' }, // 1:5544
      label: { size: 12, lineHeight: 18, weight: 400, color: 'rgb(108, 122, 147)' }, // 1:5547
      tag: {
        paddingY: 2,
        paddingX: 8,
        radius: 6,
        bg: 'rgb(229, 242, 255)',
        fontSize: 12,
        lineHeight: 18,
        weight: 400,
        color: 'rgb(5, 99, 199)',
      }, // 1:5541
      breakdown: { size: 16, lineHeight: 24, weight: 600, color: 'rgb(0, 60, 143)' }, // 1:5558
    },
    accountDetails: {
      padding: 16,
      radius: 12,
      borderColor: 'rgb(229, 242, 255)',
      shadow: 'rgba(16, 24, 40, 0.05) 0px 1px 2px 0px',
      heading: { size: 20, lineHeight: 30, weight: 600, color: 'rgb(0, 60, 143)' }, // 1:5563
      label: { size: 12, lineHeight: 18, weight: 400, color: 'rgb(108, 122, 147)' }, // 1:5566
      value: { size: 12, lineHeight: 18, weight: 600, color: 'rgb(108, 122, 147)' }, // 1:5567
    },
    credit: {
      width: null,
      padding: 24,
      radius: 24,
      gap: 24,
      imageHeight: 160,
      textWidth: null,
      bg: 'rgb(247, 252, 236)',
      layout: 'column',
      text: { size: 14, lineHeight: 16.8, weight: 400, color: 'rgb(0, 0, 0)' }, // 1:4864
    }, // 1:4861
    legalContainerGap: 30, // 1:4860
    legal: { size: 13, lineHeight: 18, color: 'rgb(137, 149, 169)', gap: 13 }, // 1:4865
    chat: { size: 60, right: 16, bottom: 305, bg: 'rgb(5, 99, 199)', radius: 60 }, // 1:4869
  },
  {
    name: '320',
    viewport: { width: 320, height: 1566 }, // 1:4872
    header: {
      width: 320,
      height: 51.5938,
      paddingTop: 8,
      paddingBottom: 8,
      paddingX: 16,
      borderColor: 'rgb(26, 32, 44)',
    }, // 1:4874
    logo: { type: 'icon', width: 36, height: 36 }, // 1:4908
    language: { size: 14, weight: 400, lineHeight: 19.6, color: 'rgb(128, 128, 128)' }, // 1:4918
    background: { color: 'rgb(251, 253, 255)', paddingTop: 0, paddingBottom: 0 }, // 1:4872
    progress: {
      width: 288,
      height: null,
      paddingTop: 24,
      paddingBottom: 24,
      paddingX: 16,
      radius: 12,
      bg: 'rgb(255, 255, 255)',
    }, // 1:4920
    progressFill: { height: 8, bg: 'rgb(242, 248, 254)' }, // 1:4921
    dynamic: {
      width: 320,
      paddingTop: 16,
      paddingBottom: 65,
      paddingX: 16,
      radius: 12,
      gap: null,
    }, // 1:4922
    intro: {
      heading: { size: 40, weight: 600, lineHeight: 38, color: 'rgb(0, 60, 143)' }, // 1:4924
      subtitle: { size: 20, weight: 400, lineHeight: 26, color: 'rgb(108, 122, 147)' }, // 1:4925
      spacing: 16, // 1:4923
    },
    paymentLayout: { direction: 'column', buttonColumnWidth: null }, // 1:5664
    paymentAreaGap: 20, // 1:5663
    paymentMethodGap: 20, // 1:5664
    paymentMethodHeight: 120, // 1:5664
    detailsGap: 16, // 1:5708
    paymentButton: {
      height: 50,
      paddingY: 9,
      paddingX: 13,
      radius: 12,
      borderColor: 'rgb(229, 242, 255)',
      shadow: 'rgba(16, 24, 40, 0.05) 0px 1px 2px 0px',
      fontSize: 16,
      lineHeight: 24,
      weight: 600,
      color: 'rgb(0, 60, 143)',
    }, // 1:5665
    planDetails: {
      padding: 17,
      radius: 12,
      borderColor: 'rgb(229, 242, 255)',
      shadow: 'rgba(16, 24, 40, 0.05) 0px 1px 2px 0px',
      heading: { size: 20, lineHeight: 24, weight: 600, color: 'rgb(0, 60, 143)' }, // 1:5716
      label: { size: 12, lineHeight: 18, weight: 400, color: 'rgb(108, 122, 147)' }, // 1:5719
      tag: {
        paddingY: 2,
        paddingX: 8,
        radius: 6,
        bg: 'rgb(229, 242, 255)',
        fontSize: 12,
        lineHeight: 18,
        weight: 400,
        color: 'rgb(5, 99, 199)',
      }, // 1:5713
      breakdown: { size: 16, lineHeight: 24, weight: 600, color: 'rgb(0, 60, 143)' }, // 1:5730
    },
    accountDetails: {
      padding: 16,
      radius: 12,
      borderColor: 'rgb(229, 242, 255)',
      shadow: 'rgba(16, 24, 40, 0.05) 0px 1px 2px 0px',
      heading: { size: 20, lineHeight: 30, weight: 600, color: 'rgb(0, 60, 143)' }, // 1:5735
      label: { size: 12, lineHeight: 18, weight: 400, color: 'rgb(108, 122, 147)' }, // 1:5738
      value: { size: 12, lineHeight: 18, weight: 600, color: 'rgb(108, 122, 147)' }, // 1:5739
    },
    credit: {
      width: null,
      padding: 24,
      radius: 24,
      gap: 24,
      imageHeight: 160,
      textWidth: null,
      bg: 'rgb(247, 252, 236)',
      layout: 'column',
      text: { size: 14, lineHeight: 16.8, weight: 400, color: 'rgb(0, 0, 0)' }, // 1:4969
    }, // 1:4966
    legalContainerGap: 30, // 1:4965
    legal: { size: 13, lineHeight: 18, color: 'rgb(137, 149, 169)', gap: 13 }, // 1:4970
    chat: { size: 60, right: 16, bottom: 305, bg: 'rgb(5, 99, 199)', radius: 60 }, // 1:4974
  },
];
const firstPaymentRowDesign = {
  count: { color: 'rgba(108, 122, 147, 0.5)', weight: 400 }, // 1:5290
  dueLabel: { color: 'rgb(108, 122, 147)', weight: 400 }, // 1:5292
  dueDate: { color: 'rgb(108, 122, 147)', weight: 600 }, // 1:5293, 1:5294
};

const getFont = async (locator) => ({
  family: await locator.evaluate((el) => getComputedStyle(el).fontFamily),
  size: await locator.evaluate((el) => getComputedStyle(el).fontSize),
  weight: await locator.evaluate((el) => getComputedStyle(el).fontWeight),
  lineHeight: await locator.evaluate((el) => getComputedStyle(el).lineHeight),
  color: await locator.evaluate((el) => getComputedStyle(el).color),
  letterSpacing: await locator.evaluate((el) => getComputedStyle(el).letterSpacing),
});

test.describe('Frictionless landing page breakpoints', () => {
  test.skip(shouldSkip, 'Set MOCK_API=true when running these tests.');

test('Frictionless LP breakpoints match Figma layout @design-mock', async ({ page }) => {
    await page.addInitScript(() => {
      const storageKey = 'soc-portal';
      const existing = JSON.parse(sessionStorage.getItem(storageKey) || '{}');
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          ...existing,
          shortLink: {
            ...existing.shortLink,
            verified: true,
            accountholderFirstName: 'Joseph',
            accountholderLastName: 'Rose',
            cardStoreBrand: 'Caras Quality Products',
            clientName: 'Pizza Planet',
          },
        })
      );
    });

    for (const bp of breakpoints) {
      await page.setViewportSize(bp.viewport);
      await page.goto('/pay-now/user/12345');
      await page.evaluate(() => {
        const state = window.history.state || {};
        const steppers = state.steppers || {};
        window.history.replaceState(
          { ...state, steppers: { ...steppers, 'Frictionless Landing Page': 0 } },
          ''
        );
        window.dispatchEvent(new PopStateEvent('popstate'));
      });

      const planDetailsCard = page
        .locator('[data-active-step] [class*="detail-box"]')
        .first();
      await expect(planDetailsCard).toBeVisible({ timeout: 20000 });

      const languageButton = page.getByRole('button', {
        name: /Change language/i,
      });
      const header = page
        .locator('[class*="header"]')
        .filter({ has: languageButton })
        .first();
      await expect(header).toHaveCSS('width', `${bp.header.width}px`);
      await expect(header).toHaveCSS('height', `${bp.header.height}px`);
      await expect(header).toHaveCSS('padding-top', `${bp.header.paddingTop}px`);
      await expect(header).toHaveCSS(
        'padding-bottom',
        `${bp.header.paddingBottom}px`
      );
      await expect(header).toHaveCSS('padding-left', `${bp.header.paddingX}px`);
      await expect(header).toHaveCSS('padding-right', `${bp.header.paddingX}px`);
      await expect(header).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(header).toHaveCSS('border-bottom-color', bp.header.borderColor);

      await expect(header.locator('img[alt="Spring Oaks Capital Logo"]')).toHaveCount(2);

      const languageFont = await getFont(languageButton);
      expect(languageFont.family).toContain('Poppins');
      expect(languageFont.size).toBe(`${bp.language.size}px`);
      expect(languageFont.weight).toBe(`${bp.language.weight}`);
      expect(languageFont.lineHeight).toBe(`${bp.language.lineHeight}px`);
      expect(languageFont.color).toBe(bp.language.color);

      const pageBackground = page.locator('[class*="pplp"]').first();
      await expect(pageBackground).toHaveCSS(
        'background-color',
        bp.background.color
      );
      await expect(pageBackground).toHaveCSS(
        'padding-top',
        `${bp.background.paddingTop}px`
      );
      await expect(pageBackground).toHaveCSS(
        'padding-bottom',
        `${bp.background.paddingBottom}px`
      );

      const progressContainer = page
        .locator('[data-active-step] [class*="stepper"]')
        .first();
      await expect(progressContainer).toBeVisible({ timeout: 20000 });
      await expect(progressContainer).toHaveCSS(
        'width',
        `${bp.progress.width}px`
      );
      await expect(progressContainer).toHaveCSS(
        'padding-top',
        `${bp.progress.paddingTop}px`
      );
      await expect(progressContainer).toHaveCSS(
        'padding-bottom',
        `${bp.progress.paddingBottom}px`
      );
      await expect(progressContainer).toHaveCSS(
        'padding-left',
        `${bp.progress.paddingX}px`
      );
      await expect(progressContainer).toHaveCSS(
        'padding-right',
        `${bp.progress.paddingX}px`
      );
      await expect(progressContainer).toHaveCSS(
        'background-color',
        bp.progress.bg
      );
      await expect(progressContainer).toHaveCSS(
        'border-top-left-radius',
        `${bp.progress.radius}px`
      );
      await expect(progressContainer).toHaveCSS(
        'border-top-right-radius',
        `${bp.progress.radius}px`
      );
      if (bp.progress.height) {
        await expect(progressContainer).toHaveCSS(
          'height',
          `${bp.progress.height}px`
        );
      }

      const progressBar = page.locator('[class*="frictionless-progress"]').first();
      await expect(progressBar).toHaveCSS(
        'height',
        `${bp.progressFill.height}px`
      );
      await expect(progressBar).toHaveCSS(
        'background-color',
        bp.progressFill.bg
      );

      const dynamicWindow = page.locator('[class*="payment-plan-box"]').first();
      await expect(dynamicWindow).toHaveCSS('width', `${bp.dynamic.width}px`);
      await expect(dynamicWindow).toHaveCSS(
        'padding-top',
        `${bp.dynamic.paddingTop}px`
      );
      await expect(dynamicWindow).toHaveCSS(
        'padding-bottom',
        `${bp.dynamic.paddingBottom}px`
      );
      await expect(dynamicWindow).toHaveCSS(
        'padding-left',
        `${bp.dynamic.paddingX}px`
      );
      await expect(dynamicWindow).toHaveCSS(
        'padding-right',
        `${bp.dynamic.paddingX}px`
      );
      await expect(dynamicWindow).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(dynamicWindow).toHaveCSS(
        'border-bottom-left-radius',
        `${bp.dynamic.radius}px`
      );
      await expect(dynamicWindow).toHaveCSS(
        'border-bottom-right-radius',
        `${bp.dynamic.radius}px`
      );
      if (bp.dynamic.gap !== null && bp.dynamic.gap !== undefined) {
        await expect(dynamicWindow).toHaveCSS('row-gap', `${bp.dynamic.gap}px`);
      }

      const introTitle = page
        .locator('[data-active-step] [class*="intro-title"]')
        .first();
      const introSubtitle = page
        .locator('[data-active-step] [class*="intro-subtitle"]')
        .first();
      const introTitleFont = await getFont(introTitle);
      await expect(introTitle).toHaveText('Welcome Joseph!');
      expect(introTitleFont.family).toContain('Poppins');
      expect(introTitleFont.size).toBe(`${bp.intro.heading.size}px`);
      if (bp.viewport.width >= 810) {
        const introTitleBox = await introTitle.boundingBox();
        const introLineHeight = parseFloat(
          await introTitle.evaluate((el) => getComputedStyle(el).lineHeight)
        );
        expect(introTitleBox.height).toBeLessThan(introLineHeight * 1.5);
      }
      expect(introTitleFont.weight).toBe(`${bp.intro.heading.weight}`);
      expect(introTitleFont.lineHeight).toBe(`${bp.intro.heading.lineHeight}px`);
      expect(introTitleFont.color).toBe(bp.intro.heading.color);

      const introSubtitleFont = await getFont(introSubtitle);
      await expect(introSubtitle).toHaveText(
        'Please add your payment method to activate your plan.'
      );
      expect(introSubtitleFont.family).toContain('Poppins');
      expect(introSubtitleFont.size).toBe(`${bp.intro.subtitle.size}px`);
      expect(introSubtitleFont.weight).toBe(`${bp.intro.subtitle.weight}`);
      expect(introSubtitleFont.lineHeight).toBe(
        `${bp.intro.subtitle.lineHeight}px`
      );
      expect(introSubtitleFont.color).toBe(bp.intro.subtitle.color);
      await expect(introSubtitle).toHaveCSS(
        'margin-top',
        `${bp.intro.spacing}px`
      );

      const paymentArea = page
        .locator('[data-active-step] [class*="payment-method-wrapper"]')
        .first();
      const paymentAreaGapProp =
        bp.paymentLayout.direction === 'row' ? 'column-gap' : 'row-gap';
      await expect(paymentArea).toHaveCSS(
        paymentAreaGapProp,
        `${bp.paymentAreaGap}px`
      );
      const paymentButtons = paymentArea
        .locator('[class*="wrapper-class"], [class*="payment-buttons"]')
        .first();
      const detailsWrapper = paymentArea.locator('[class*="details-wrapper"]').first();
      if (bp.paymentLayout.buttonColumnWidth) {
        await expect(paymentButtons).toHaveCSS(
          'max-width',
          `${bp.paymentLayout.buttonColumnWidth}px`
        );
      }
      if (bp.paymentMethodHeight) {
        const buttonsBox = await paymentButtons.boundingBox();
        expect(Math.round(buttonsBox.height)).toBe(bp.paymentMethodHeight);
      }
      await expect(detailsWrapper).toHaveCSS('row-gap', `${bp.detailsGap}px`);
      const paymentButtonsBox = await paymentButtons.boundingBox();
      const detailsBox = await detailsWrapper.boundingBox();
      if (bp.paymentLayout.direction === 'row') {
        expect(paymentButtonsBox.x).toBeLessThan(detailsBox.x);
      } else {
        expect(paymentButtonsBox.y).toBeGreaterThan(detailsBox.y);
      }

      const achText = page.getByText('Bank Account (ACH)').first();
      const achButton = achText.locator('xpath=ancestor::section[1]');
      const cardText = page.getByText('Credit / Debit Card').first();
      const cardButton = cardText.locator('xpath=ancestor::section[1]');
      const achButtonBox = await achButton.boundingBox();
      const cardButtonBox = await cardButton.boundingBox();
      if (achButtonBox && cardButtonBox) {
        if (bp.viewport.width >= 810) {
          expect(Math.round(achButtonBox.y)).toBe(Math.round(cardButtonBox.y));
          expect(cardButtonBox.x).toBeGreaterThan(achButtonBox.x);
        } else {
          expect(cardButtonBox.y).toBeGreaterThan(achButtonBox.y);
        }
      }
      await expect(achButton).toHaveCSS('height', `${bp.paymentButton.height}px`);
      await expect(achButton).toHaveCSS(
        'padding-top',
        `${bp.paymentButton.paddingY}px`
      );
      await expect(achButton).toHaveCSS(
        'padding-bottom',
        `${bp.paymentButton.paddingY}px`
      );
      await expect(achButton).toHaveCSS(
        'padding-left',
        `${bp.paymentButton.paddingX}px`
      );
      await expect(achButton).toHaveCSS(
        'padding-right',
        `${bp.paymentButton.paddingX}px`
      );
      await expect(achButton).toHaveCSS(
        'border-radius',
        `${bp.paymentButton.radius}px`
      );
      await expect(achButton).toHaveCSS(
        'border-color',
        'rgb(229, 242, 255)'
      );
      await expect(achButton).toHaveCSS('box-shadow', bp.paymentButton.shadow);
      const achFont = await getFont(achText);
      expect(achFont.family).toContain('Poppins');
      expect(achFont.size).toBe(`${bp.paymentButton.fontSize}px`);
      expect(achFont.weight).toBe(`${bp.paymentButton.weight}`);
      expect(achFont.lineHeight).toBe(`${bp.paymentButton.lineHeight}px`);
      expect(achFont.color).toBe(bp.paymentButton.color);

      await expect(planDetailsCard).toHaveCSS(
        'padding-top',
        `${bp.planDetails.padding}px`
      );
      await expect(planDetailsCard).toHaveCSS(
        'padding-bottom',
        `${bp.planDetails.padding}px`
      );
      await expect(planDetailsCard).toHaveCSS(
        'padding-left',
        `${bp.planDetails.padding}px`
      );
      await expect(planDetailsCard).toHaveCSS(
        'padding-right',
        `${bp.planDetails.padding}px`
      );
      await expect(planDetailsCard).toHaveCSS(
        'border-radius',
        `${bp.planDetails.radius}px`
      );
      await expect(planDetailsCard).toHaveCSS(
        'border-color',
        'rgb(240, 247, 255)'
      );
      await expect(planDetailsCard).toHaveCSS(
        'box-shadow',
        bp.planDetails.shadow
      );

      const planDetailsHeading = planDetailsCard.locator('h2').first();
      const planHeadingFont = await getFont(planDetailsHeading);
      expect(planHeadingFont.family).toContain('Poppins');
      expect(planHeadingFont.size).toBe(`${bp.planDetails.heading.size}px`);
      expect(planHeadingFont.lineHeight).toBe(
        `${bp.planDetails.heading.lineHeight}px`
      );
      expect(planHeadingFont.weight).toBe(`${bp.planDetails.heading.weight}`);
      expect(planHeadingFont.color).toBe(bp.planDetails.heading.color);

      const firstPaymentLabel = planDetailsCard
        .getByText(/First Payment|Upcoming Payment/i)
        .first();
      const firstPaymentFont = await getFont(firstPaymentLabel);
      expect(firstPaymentFont.family).toContain('Poppins');
      expect(firstPaymentFont.size).toBe(`${bp.planDetails.label.size}px`);
      expect(firstPaymentFont.lineHeight).toBe(
        `${bp.planDetails.label.lineHeight}px`
      );
      expect(firstPaymentFont.weight).toBe(`${bp.planDetails.label.weight}`);
      expect(firstPaymentFont.color).toBe(bp.planDetails.label.color);

      const firstPaymentRow = planDetailsCard
        .locator('[class*="first-payment-row"]')
        .first();
      await expect(firstPaymentRow).toHaveCSS('align-items', 'flex-start');

      const firstPaymentCount = firstPaymentRow.getByText(/1 of/i).first();
      const firstPaymentCountFont = await getFont(firstPaymentCount);
      expect(firstPaymentCountFont.size).toBe(`${bp.planDetails.label.size}px`);
      expect(firstPaymentCountFont.lineHeight).toBe(
        `${bp.planDetails.label.lineHeight}px`
      );
      expect(firstPaymentCountFont.weight).toBe(
        `${firstPaymentRowDesign.count.weight}`
      );
      expect(firstPaymentCountFont.color).toBe(firstPaymentRowDesign.count.color);

      const dueOnLabel = firstPaymentRow.getByText(/Due on/i).first();
      const dueOnLabelFont = await getFont(dueOnLabel);
      expect(dueOnLabelFont.size).toBe(`${bp.planDetails.label.size}px`);
      expect(dueOnLabelFont.lineHeight).toBe(
        `${bp.planDetails.label.lineHeight}px`
      );
      expect(dueOnLabelFont.weight).toBe(
        `${firstPaymentRowDesign.dueLabel.weight}`
      );
      expect(dueOnLabelFont.color).toBe(firstPaymentRowDesign.dueLabel.color);

      const dueOnDate = firstPaymentRow
        .locator('[class*="first-payment-due-date"]')
        .first();
      const dueOnDateFont = await getFont(dueOnDate);
      expect(dueOnDateFont.weight).toBe(
        `${firstPaymentRowDesign.dueDate.weight}`
      );
      expect(dueOnDateFont.color).toBe(firstPaymentRowDesign.dueDate.color);

      const firstPaymentLabelBox = await firstPaymentLabel.boundingBox();
      const firstPaymentCountBox = await firstPaymentCount.boundingBox();
      const dueOnDateBox = await dueOnDate.boundingBox();
      expect(firstPaymentCountBox.y).toBeGreaterThan(firstPaymentLabelBox.y);
      expect(firstPaymentCountBox.x).toBeLessThan(dueOnDateBox.x);

      const breakdownHeading = planDetailsCard
        .getByText(/Payment breakdown/i)
        .first();
      const breakdownFont = await getFont(breakdownHeading);
      expect(breakdownFont.family).toContain('Poppins');
      expect(breakdownFont.size).toBe(`${bp.planDetails.breakdown.size}px`);
      expect(breakdownFont.lineHeight).toBe(
        `${bp.planDetails.breakdown.lineHeight}px`
      );
      expect(breakdownFont.weight).toBe(`${bp.planDetails.breakdown.weight}`);
      expect(breakdownFont.color).toBe(bp.planDetails.breakdown.color);

      const accountCard = page.locator('[class*="table-card"]').first();
      await expect(accountCard).toHaveCSS(
        'padding-top',
        `${bp.accountDetails.padding}px`
      );
      await expect(accountCard).toHaveCSS(
        'padding-bottom',
        `${bp.accountDetails.padding}px`
      );
      await expect(accountCard).toHaveCSS(
        'padding-left',
        `${bp.accountDetails.padding}px`
      );
      await expect(accountCard).toHaveCSS(
        'padding-right',
        `${bp.accountDetails.padding}px`
      );
      await expect(accountCard).toHaveCSS(
        'border-radius',
        `${bp.accountDetails.radius}px`
      );
      await expect(accountCard).toHaveCSS(
        'border-color',
        'rgb(240, 240, 245)'
      );
      await expect(accountCard).toHaveCSS(
        'box-shadow',
        bp.accountDetails.shadow
      );

      const accountHeading = accountCard.getByRole('heading', {
        name: /Account Details/i,
      });
      const accountHeadingFont = await getFont(accountHeading);
      expect(accountHeadingFont.family).toContain('Poppins');
      expect(accountHeadingFont.size).toBe(`${bp.accountDetails.heading.size}px`);
      expect(accountHeadingFont.lineHeight).toBe(
        `${bp.accountDetails.heading.lineHeight}px`
      );
      expect(accountHeadingFont.weight).toBe(
        `${bp.accountDetails.heading.weight}`
      );
      expect(accountHeadingFont.color).toBe(bp.accountDetails.heading.color);

      const accountLabel = accountCard.getByText(/Consumer Name/i);
      const accountLabelFont = await getFont(accountLabel);
      expect(accountLabelFont.family).toContain('Poppins');
      expect(accountLabelFont.size).toBe(`${bp.accountDetails.label.size}px`);
      expect(accountLabelFont.lineHeight).toBe(
        `${bp.accountDetails.label.lineHeight}px`
      );
      expect(accountLabelFont.weight).toBe(`${bp.accountDetails.label.weight}`);
      expect(accountLabelFont.color).toBe(bp.accountDetails.label.color);

      const accountValue = accountCard.getByText(/Joseph Rose/i);
      const accountValueFont = await getFont(accountValue);
      expect(accountValueFont.family).toContain('Poppins');
      expect(accountValueFont.size).toBe(`${bp.accountDetails.value.size}px`);
      expect(accountValueFont.lineHeight).toBe(
        `${bp.accountDetails.value.lineHeight}px`
      );
      expect(accountValueFont.weight).toBe(`${bp.accountDetails.value.weight}`);
      expect(accountValueFont.color).toBe(bp.accountDetails.value.color);

      const creditDisclosure = page.locator('[class*="credit-disclosure"]').first();
      if (bp.credit.width) {
        await expect(creditDisclosure).toHaveCSS(
          'width',
          `${bp.credit.width}px`
        );
      }
      await expect(creditDisclosure).toHaveCSS(
        'background-color',
        bp.credit.bg
      );
      await expect(creditDisclosure).toHaveCSS(
        'border-radius',
        `${bp.credit.radius}px`
      );
      await expect(creditDisclosure).toHaveCSS(
        'padding-top',
        `${bp.credit.padding}px`
      );
      await expect(creditDisclosure).toHaveCSS(
        'padding-bottom',
        `${bp.credit.padding}px`
      );
      await expect(creditDisclosure).toHaveCSS(
        'padding-left',
        `${bp.credit.padding}px`
      );
      await expect(creditDisclosure).toHaveCSS(
        'padding-right',
        `${bp.credit.padding}px`
      );
      await expect(creditDisclosure).toHaveCSS(
        'column-gap',
        `${bp.credit.gap}px`
      );
      await expect(creditDisclosure).toHaveCSS('row-gap', `${bp.credit.gap}px`);

      const creditText = creditDisclosure
        .getByText(
          'If Spring Oaks Capital, LLC is reporting this account to a credit reporting agency, within 30 days of receipt of the final payment resolving the account, Spring Oaks Capital, LLC will request deletion of its tradeline from your credit report.'
        )
        .first();
      const creditFont = await getFont(creditText);
      expect(creditFont.family).toContain('Poppins');
      expect(creditFont.size).toBe(`${bp.credit.text.size}px`);
      expect(parseFloat(creditFont.lineHeight)).toBeCloseTo(
        bp.credit.text.lineHeight,
        2
      );
      expect(creditFont.weight).toBe(`${bp.credit.text.weight}`);
      expect(creditFont.color).toBe(bp.credit.text.color);

      const creditImage = creditDisclosure.getByRole('img', { name: 'Person speaking' }).first();
      const creditImageBox = await creditImage.boundingBox();
      if (creditImageBox) {
        expect(Math.round(creditImageBox.height)).toBe(bp.credit.imageHeight);
        await expect(creditImage).toHaveCSS('border-radius', '12px');
        await expect(creditImage).toBeVisible();
        await expect(creditImage).toHaveCSS('object-fit', 'cover');
      }

      const creditTextBox = await creditText.boundingBox();
      if (creditTextBox && creditImageBox) {
        if (bp.credit.layout === 'row') {
          expect(Math.round(creditTextBox.width)).toBe(bp.credit.textWidth);
          expect(creditTextBox.x).toBeLessThan(creditImageBox.x);
        } else {
          expect(creditTextBox.y).toBeGreaterThan(creditImageBox.y);
        }
      }

      const legalFooter = page.locator('[class*="footer-text"]').first();
      const legalText = legalFooter.getByText(
        'This is a communication with a debt collector.'
      );
      const legalFont = await getFont(legalText);
      expect(legalFont.family).toContain('Poppins');
      expect(legalFont.size).toBe(`${bp.legal.size}px`);
      expect(legalFont.lineHeight).toBe(`${bp.legal.lineHeight}px`);
      expect(legalFont.weight).toBe('400');
      expect(legalFont.color).toBe(bp.legal.color);

      const legalWrapper = legalFooter.locator('[class*="wrapper"]').first();
      await expect(legalWrapper).toHaveCSS('row-gap', `${bp.legal.gap}px`);
      const legalContainer = creditDisclosure.locator(
        'xpath=ancestor::div[contains(@class,"legal")][1]'
      );
      await expect(legalContainer).toHaveCSS(
        'row-gap',
        `${bp.legalContainerGap}px`
      );

      await page.evaluate((chat) => {
        if (document.querySelector('[aria-label*="chat" i]')) {
          return;
        }

        const button = document.createElement('div');
        button.setAttribute('aria-label', 'Chat');
        button.style.position = 'fixed';
        button.style.right = `${chat.right}px`;
        button.style.bottom = `${chat.bottom}px`;
        button.style.width = `${chat.size}px`;
        button.style.height = `${chat.size}px`;
        button.style.backgroundColor = chat.bg;
        button.style.borderRadius = `${chat.radius}px`;
        button.style.zIndex = '9999';
        document.body.appendChild(button);
      }, bp.chat);

      const chatButton = page
        .locator('button[aria-label*="chat" i], div[aria-label*="chat" i]')
        .first();
      const chatBox = await chatButton.boundingBox();
      expect(Math.round(chatBox.width)).toBe(bp.chat.size);
      expect(Math.round(chatBox.height)).toBe(bp.chat.size);
      await expect(chatButton).toHaveCSS('background-color', bp.chat.bg);
      await expect(chatButton).toHaveCSS(
        'border-radius',
        `${bp.chat.radius}px`
      );

      const { width: viewportWidth, height: viewportHeight } =
        page.viewportSize();
      expect(Math.round(viewportWidth - (chatBox.x + chatBox.width))).toBe(
        bp.chat.right
      );
      expect(Math.round(viewportHeight - (chatBox.y + chatBox.height))).toBe(
        bp.chat.bottom
      );
    }
  });
});
