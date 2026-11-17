# أصول الدخول إلى تسويقات

حُفظت هذه الأصول محليًا في 17 نوفمبر 2026. الأيقونات للدخول إلى حساب تسويقات فقط، وليست شارات ربط القنوات أو الإعلانات. لم تُرسم شعارات بديلة، ولم تُستخدم أيقونات عامة بدل علامات Google أو Apple.

## Google

أصل العرض هو `google-official.png`، نسخة PNG @2x من زر الأيقونة المربع الفاتح في حزمة Google الرسمية. يحتفظ الأصل بالشعار القياسي متعدد الألوان، والخلفية البيضاء، والنسب والحواف والتباعد الأصلي. يُعرض بحجم 40 × 40 CSS pixels، مع نص عربي واضح يصف إجراء الدخول داخل زر حقيقي. لم يُقصّ الشعار ولم يُعاد تلوينه.

المصدر: [Sign in with Google Branding Guidelines](https://developers.google.com/identity/branding-guidelines). فُتح المصدر للتحقق من قواعد الحجم والنص والألوان؛ يمنع استخدام نسخة Google G أحادية اللون في زر الدخول. رابط الحزمة الأصلية: [signin-assets.zip](https://developers.google.com/static/identity/images/signin-assets.zip). المسار داخل الحزمة: `Android + Web/PNG @2x/Light/Theme=Light, Show text=No, Shape=Square, Platform=Android+Web@2x.png`.

`google-official.svg` نسخة SVG مطابقة من نفس حزمة الأيقونة. حُفظت للمرجعية فقط؛ الواجهة تستخدم PNG لأن SVG الأصلي يحتوي `foreignObject` وتدرجًا مخروطيًا قد لا يُعرضان reliably في سياق صورة SVG خارجية.

استخدام العلامة يخضع لإرشادات Google، لا لرخصة Simple Icons. لا تعني قواعد ترخيص نصوص Google Developers تلقائيًا ترخيصًا عامًا للشعار. هذا استخدام علامة Google داخل خيار دخول Google فقط، وليس ادعاء شراكة أو توصية.

## Apple

أصل العرض هو `apple-official.svg`، باستخدام مسار الشعار الرسمي من عنصر `logo-only` في SDK الويب الذي توثقه Apple. حُفظت هندسة المسار و`viewBox="6 6 44 44"` والتباعد الداخلي دون تغيير. اللون أسود على أبيض، ولا يوجد رسم بديل أو تحويل إلى لون هوية تسويقات. لا تُنفّذ الواجهة SDK ولا ترسل طلبات مصادقة عبره؛ تستعمل SVG المحلي فقط، بينما يوفّر الخادم رابط بدء الدخول.

المصادر المفتوحة: [Sign in with Apple — Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple)، [Displaying Sign in with Apple buttons on the web](https://developer.apple.com/documentation/signinwithapple/displaying-sign-in-with-apple-buttons-on-the-web)، و[Apple Design Resources](https://developer.apple.com/design/resources/). مصدر المسار الثابت: [Apple Web SDK](https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js). لم يُشغّل هذا SDK أو أي عملية تسجيل دخول أثناء الجمع أو الاختبار.

شعار Apple ملك لجهة العلامة ويخضع لقواعد استعمالها؛ ليس شعارًا أصليًا لتسويقات. لا تُعامل هذه الأيقونة كأصل CC0.

## النسخ الأصلية المجمّعة من Simple Icons

`apple.svg` و`google-simpleicons.svg` نسختان غير معدلتين من `package/icons/apple.svg` و`package/icons/google.svg` في `/home/ubuntu/simple-icons-assets.tgz`، حزمة Simple Icons 16.38 التي جمعها الوكيل الرئيسي مسبقًا. حُفظتا للمصدر والمرجعية؛ أزرار الدخول تستخدم أصول العرض الرسمية أعلاه بدل النسخة الأحادية اللون من Google.

المصدر: [Simple Icons](https://simpleicons.org/) و[المستودع](https://github.com/simple-icons/simple-icons). نسخ الرخصة والتنبيه الأصلية محلية: `LICENSE-simple-icons.md` و`DISCLAIMER-simple-icons.md`. المكتبة CC0-1.0؛ حقوق العلامات مستقلة، ولا تعني رخصة المكتبة اعتماد استخدامها لأي غرض.

## عقد الدمج

حمّل `/assets/auth-portal.css` بعد `pulse.css` و`session.css`، وحمّل `/assets/auth-portal.js` بعد تعريف `TaswiqatAPI` وقبل استدعاء الجسر له. الملفات لا تعدّل `app.js` أو API أو المسارات أو بيانات مساحة العمل.

```js
window.TaswiqatAuthPortal.mount(panel, {
  view: 'login', // login | register | forgot | reset | verify
  message: '',
  invite: false,
  setup: false,
  onManusLogin: async function () {},
  onAuthenticated: async function (response) {},
  onHome: function () {},
  onDemo: function () {},
  onNavigate: function (view) {}
});
```

`mount` يضيف `auth-portal-card` إلى البطاقة ويبني عقدة مملوكة له. يعيد `{unmount, refreshOptions}`. استدعاء `TaswiqatAuthPortal.unmount(panel)` قبل عرض واجهة الجلسة/مساحة العمل القديمة يزيل العقدة المملوكة والمستمعين والصنف، ويمحو حقول كلمات المرور والرمز من ذاكرة هذه البوابة ويلغي تأثير النتائج المتأخرة. لا يقرأ أو يغيّر التخزين المحلي أو دعوات الجلسة. يمكن استعمال `unmount()` دون وسيط لآخر بطاقة مركّبة.

يتولى `onNavigate(view)` الجسر وتحديث المسار؛ لا تكتب البوابة hash بنفسها. الروابط الاحتياطية تصف `#auth/login` و`#auth/register` و`#auth/forgot` فقط، لكن النقر الذي يُدار عبر البوابة يستدعي الجسر دون انتقال تلقائي. رموز `reset` و`verify` تُقرأ من `location.hash` query داخل الذاكرة فقط؛ لا تظهر في DOM أو سجل، ولا تُقرأ لأي عرض آخر.

الحد الأدنى للعقد: `TaswiqatAPI.authOptions()` يرجع booleans فعلية لـ `manus,email,google,apple,registrationEnabled`؛ API وحده يحتفظ برمز CSRF. `authEmail(action,payload)` يرجع `{ok:true,message}` للنجاح المؤكد، و`authProviderStart(provider)` يرجع `{url}`. تؤخذ رسالة النجاح كما أكدها الخادم وتعرض كنص لا HTML. الاستجابات غير المؤكدة والشبكات والأخطاء لا تعرض raw payload أو `error.message`.

طلب `register` لا يحتوي كلمة مرور: `{name,email}` فقط. `verify` و`reset` يرسلان `{token,password}` بعد تحقق 12–128 حرفًا والتأكيد. `login` يرسل `{email,password}` و`forgot` يرسل `{email}`. عند login/verify المؤكد فقط يُستدعى `onAuthenticated(response)`؛ الجسر مسؤول عن تحديث الجلسة وتحميل مساحة العمل. reset لا ينشئ جلسة واجهة بل يظهر رسالة الخادم وزر العودة للدخول.

الخيارات غير المتاحة ليست إجراءات شكلية: البريد يعرض النماذج مع تعطيل الإرسال وملاحظة «تسجيل البريد واستعادة كلمة المرور قيد التفعيل». Google/Apple موسومان «قيد التفعيل» حتى تأكيد قدرات الخادم. الدخول الآمن عبر Manus لا يظهر إلا عند تأكيد `manus:true` مع توفير callback؛ يبقى متاحًا أثناء إعادة تحميل القدرات إذا سبق تأكيده. إغلاق التسجيل يعطل إنشاء البريد والمزودين في عرض التسجيل، مع بقاء دخول الحسابات الحالية في عرض login. التجربة المحلية خيار منفصل وصريح يستدعي callback فقط، وليست fallback بعد أي فشل مصادقة.

## التحقق

أُجري `node --check assets/auth-portal.js` بنجاح. لم يُشغّل تسجيل دخول أو OAuth أو إرسال بريد أو تغيير قاعدة بيانات. الفحص البصري مسؤولية الوكيل الرئيسي وفق تقسيم المهمة.
