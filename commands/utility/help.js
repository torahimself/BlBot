// /help — what the bot does, for members (no staff commands). A button switches English ⇄ العربية.
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const COLOR = 0x8b5cf6;

const TEXT = {
  en: {
    title: 'BlBot — what I can do',
    intro: 'Earn coins by chatting and hanging out in voice, play games, collect titles and badges, and customise your profile card.',
    sections: [
      ['Earning coins & levels',
        '• Chat and spend time in voice channels — you earn coins and XP automatically.\n' +
        '• `/work` — a daily job for 250–1000 coins.\n' +
        '• Keep a daily streak by being active every day; streaks unlock titles and card backgrounds.\n' +
        '• Boost potions drop while you chat — activate them in `/inventory` for extra coins.\n' +
        '• `/drop` — turn drop notifications (DMs) on or off.'],
      ['Chat games (type in the game channels)',
        'Type a dot and the game word: `.علم` flags · `.عاصمة` capitals · `.مافيا` mafia · `.ريبليكا` categories · `.روليت` elimination roulette · `.جيو` geo guessing · `.كتابة` typing race · `.سلسلة` word chain · `.حساب` math.\n' +
        '• Add a number to bet, e.g. `.علم 500` — everyone who joins puts in the same stake and the winner takes the pot. No number = free game. If nobody else joins, your stake is returned.\n' +
        '• `.توقف` (or `.stop`) ends a game — the one who started it or a moderator can do it, and everyone is refunded.\n' +
        '• `.العاب` shows every game with a short explanation.'],
      ['Slash games',
        '`/coinflip` `/numberduel` `/blackjack` — duel another member\n' +
        '`/dice` `/roulette` — play alone, free or with a bet\n' +
        '`/lastmanstanding` `/russianroulette` `/hotpotato` — group games, last survivor wins the pot'],
      ['Profile & inventory',
        '• `/profile` — your picture card: level, ranks, streaks, titles and badges.\n' +
        '• `/inventory` — coins, potions and active boosts.\n' +
        '• The Customize button on your card lets you pick a title, theme colours and a background.'],
      ['Shop & roles',
        '• `/buy` — buy your own custom role, or open the limited-time seasonal shop (titles, card colours, backgrounds).\n' +
        '• `/myrole` `/editrole` `/addmember` `/removemember` `/extendrole` — manage the role you bought.'],
      ['More',
        '• `/trade` — send coins to another member.\n' +
        '• `/topcoins` — the richest members.\n' +
        '• Post a TikTok or Instagram link and I embed the video for you.\n' +
        '• New posts from tracked X accounts appear automatically.'],
    ],
    footer: 'Need staff help? Ask a moderator.',
    switchLabel: 'العربية',
  },
  ar: {
    title: 'BlBot — ماذا يفعل البوت؟',
    intro: 'اكسب عملات بالدردشة وقضاء الوقت في الصوت، والعب الألعاب، واجمع الألقاب والشارات، وخصّص بطاقة ملفك.',
    sections: [
      ['كسب العملات والمستوى',
        '• تحدّث في الشات وتواجد في القنوات الصوتية — تكسب عملات وخبرة تلقائيًا.\n' +
        '• `/work` — عمل يومي بين 250 و1000 عملة.\n' +
        '• حافظ على سلسلة يومية بالتفاعل كل يوم؛ السلاسل تفتح ألقابًا وخلفيات للبطاقة.\n' +
        '• تسقط جرعات التعزيز أثناء الدردشة — فعّلها من `/inventory` للحصول على عملات أكثر.\n' +
        '• `/drop` — تشغيل أو إيقاف إشعارات السقوط (رسائل خاصة).'],
      ['ألعاب الشات (اكتبها في قنوات الألعاب)',
        'اكتب نقطة ثم اسم اللعبة: `.علم` أعلام · `.عاصمة` عواصم · `.مافيا` مافيا · `.ريبليكا` فئات · `.روليت` روليت الطرد · `.جيو` تخمين المكان · `.كتابة` سباق كتابة · `.سلسلة` سلسلة كلمات · `.حساب` رياضيات.\n' +
        '• أضف رقمًا للرهان مثل `.علم 500` — كل من ينضم يدفع نفس المبلغ والفائز يأخذ الجائزة. بدون رقم تكون اللعبة مجانية. إذا لم ينضم أحد يُرجع لك رهانك.\n' +
        '• `.توقف` (أو `.stop`) تُنهي اللعبة — يستطيع من بدأها أو أي مشرف ذلك، ويُعاد الرهان للجميع.\n' +
        '• `.العاب` تعرض كل الألعاب مع شرح قصير.'],
      ['ألعاب الأوامر المائلة',
        '`/coinflip` `/numberduel` `/blackjack` — تحدَّ عضوًا آخر\n' +
        '`/dice` `/roulette` — العب وحدك، مجانًا أو برهان\n' +
        '`/lastmanstanding` `/russianroulette` `/hotpotato` — ألعاب جماعية، آخر ناجٍ يفوز بالجائزة'],
      ['الملف الشخصي والحقيبة',
        '• `/profile` — بطاقتك المصورة: المستوى والترتيب والسلاسل والألقاب والشارات.\n' +
        '• `/inventory` — عملاتك وجرعاتك والتعزيزات المفعّلة.\n' +
        '• زر التخصيص في البطاقة يتيح لك اختيار اللقب وألوان الثيم والخلفية.'],
      ['المتجر والرتب',
        '• `/buy` — اشترِ رتبتك الخاصة، أو افتح المتجر الموسمي المحدود (ألقاب وألوان بطاقة وخلفيات).\n' +
        '• `/myrole` `/editrole` `/addmember` `/removemember` `/extendrole` — إدارة الرتبة التي اشتريتها.'],
      ['أشياء أخرى',
        '• `/trade` — أرسل عملات لعضو آخر.\n' +
        '• `/topcoins` — أغنى الأعضاء.\n' +
        '• ضع رابط تيك توك أو إنستغرام وسأعرض الفيديو لك.\n' +
        '• تظهر المنشورات الجديدة للحسابات المتابَعة على X تلقائيًا.'],
    ],
    footer: 'تحتاج مساعدة من الإدارة؟ كلّم أحد المشرفين.',
    switchLabel: 'English',
  },
};

function build(lang, userId) {
  const t = TEXT[lang] || TEXT.en, other = lang === 'ar' ? 'en' : 'ar';
  const embed = new EmbedBuilder().setColor(COLOR).setTitle(t.title).setDescription(t.intro).setFooter({ text: t.footer });
  for (const [name, value] of t.sections) embed.addFields({ name, value: value.slice(0, 1024) });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`help:${other}:${userId}`).setLabel(t.switchLabel).setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder().setName('help').setDescription('What the bot does — with an Arabic / English switch'),
  async execute(interaction) {
    await interaction.editReply(build('en', interaction.user.id));
  },
  /** Language button: customId "help:<lang>:<userId>". */
  async handle(interaction) {
    const [, lang, owner] = String(interaction.customId).split(':');
    if (owner && owner !== interaction.user.id) return interaction.reply({ content: 'This menu is not yours — run /help.', flags: 64 });
    await interaction.update(build(lang === 'ar' ? 'ar' : 'en', interaction.user.id));
  },
  build,
};
