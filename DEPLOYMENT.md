# حالة النشر — تسويقات

الموقع الحالي: https://lawnalamak.github.io/taswiqat-cloud/ . دُمج PR1 https://github.com/lawnalamak/taswiqat-cloud/pull/1، merge commit 73bdf408ff00aa585ece438257afef52df8a913b. تحقق GitHub Pages من build=built ومن HTTP200 للهوية البنفسجية والواجهة الجديدة. أضيف نطاق المسؤوليات المصحح إلى main في ad75de7، وتعليق https://github.com/lawnalamak/taswiqat-cloud/pull/1#issuecomment-6943973190.

نشر الخادم الأول تأكد من نتيجة Publish في 17 نوفمبر 2026: version 349f3b69e3aa21708bb8882dbe21a2f450564864، الرابط https://taswiqat-ayt7ghj3.manus.space . هذا إصدار منشور، لكنه ليس دليلًا أن إعداد الرؤية يسمح لكل الزوار؛ أول نشر يديره اختيار Private/Public في بطاقة النشر.

المصادقة الفعلية نجحت في المعاينة بعد دخول صاحب الحساب واختيار هويته: admin pin مثبت وسجل admin حقيقي واحد، دون زوار مدراء أو سجلات اختبار. GET session وadmin/state أعادا 200 تحت الجلسة، المستخدم role=admin، workspaces=0 وplans=3. /api/health الفعلي 200/schemaVersion2. الزائر والجلسة المزورة رفضا 401، state غير صالح رفض400، كتابة بلا CSRF رفض403.

ظهر أثناء الحفظ الفعلي عيب نقل مصدر الطلب في بروكسي المعاينة: الخادم يستقبل Origin=http://127.0.0.1:3000 بدل الأصل HTTPS للمتصفح. أُصلح بإرسال X-Taswiqat-Origin وفحصه ضد الجلسة الموقعة/قائمة الأصل الفعلي، مع إبقاء HMAC ورفض null والمصادر الأخرى. التشخيص المؤقت أُزيل. فحوص الإصلاح offline ناجحة؛ إعادة فحص الحفظ ثم إصدار الخادم المصحح ورفع رابط الانتقال إلى GitHub Pages ما زالت مطلوبة عند كتابة هذا السجل.

الباقات والاشتراكات سجلات تجربة/إدارة لا تحصيل مالي. التكاملات الاجتماعية وقوقل من مسؤولية الوكيل الثاني وحده؛ بقية النظام من مسؤولية الوكيل الرئيسي. إعدادات CMS عامة فقط، وبيانات العملاء/API محمية لا CORS عام. روابط الدعوات قابلة للنسخ وليست بريدًا مرسلًا. لا تغيير للدومين الآن.

## فحص الإصلاح الفعلي — 17 نوفمبر 2026، 10:06 UTC

الخادم المصحح جاهز/schemaVersion2. بعد تحميل admin.js الجديد في المتصفح، أكد ناقل adminRequest وجود X-Taswiqat-Origin؛ PUT snapshot بالقيم نفسها نجح ورفع revision من2 إلى3. طلب بلاCSRF رفض403 ومصدر متصفح مزوّر رفض403. بقي userCount1/workspaceCount0 والقيم العامة/الإعدادات دون تغيير. آخر اختبارات الإدارة والمصادقة المتأثرة18/18 ناجحة. مستوى الوصول المقروء من إعداد المنصة هو owner/privateFirstPublish؛ لا ادعاء فتح عام. نشر الإصلاح ورفع المصدر إلى GitHub Pages هما الخطوتان التاليتان.

## الإصدار المصحح والتحقق في الإنتاج — 10:17 UTC

نتيجة النشر النهائية published، version869108eeeb05a7d2f7b6b6e75df5315b2f8f84f3، على https://taswiqat-ayt7ghj3.manus.space. GitHub main f1d1d5dc4f448fd99d1644c5a373a35c56a74876 يحمل النظام الكامل؛ Pages build=built لهذا commit، وملفات الربط والإدارة الحية HTTP200. ملفات التكامل القديم ومخططه وملف البيئة لم تتغير. ملاحظة التنسيق: https://github.com/lawnalamak/taswiqat-cloud/pull/1#issuecomment-6945059497 .

بعد تفويض بوابة الوصول الخاصة ثم OAuth التطبيق نفسه بالهوية المعتمدة، callback عاد إلى admin.html. القراءة من المتصفح على الدومين المنشور: health200/session authenticated=true role=admin/admin GET200. حفظ snapshot دون تغيير القيم عبر adminRequest المنشور نجح ورفع revision4 إلى5؛ transportFixed=true/userCount1/workspaceCount0/unchangedSite=true. لا أسرار أو رموز جلسة في هذا السجل، ولا عملاء اختبار.

مستوى الوصول owner/private باقٍ؛ اختيار Public في بطاقة النشر بيد المالك ولا يتطلب إعادة نشر. لا تحصيل ولا تكامل اجتماعي ولا worker نشر ولا دعوة بريدية مفعّلة. تحديث أدلة المستندات بعد869108e لا يغير ملفات التطبيق المنشور.

## الرابط المختصر — 11:18 UTC

بناءً على طلب المالك اللاحق لتقصير الرابط دون تغيير اسم «تسويقات»، حُفظ taswiqat من Settings > Domains > Edit URL وظهرت Saved successfully. التطبيق الحالي https://taswiqat.manus.space والإدارة https://taswiqat.manus.space/admin.html. الصحة200/ready=true/schemaVersion2 على الأصل الجديد. visibility=owner/privateFirstPublish=true بقيت، ولم يحدث شراء نطاق أو نشر إصدار خادم آخر. assets/deployment.js يوجّه الدخول من GitHub Pages إلى الأصل الجديد فقط؛ المعاينة والتطبيق المنشور يبقيان same-origin.

طلب المالك لاحقًا إلغاء العنوان السابق. فحص 11:24 UTC أكد أنه ما زال يرد: / يحوّل302 إلى بوابة الوصول الخاص و/api/health يرجع200. لا يظهر في Domains المتاح خيار حذف alias الافتراضي السابق؛ لم يُعطّل فعليًا. لا يُعامل تحديث الروابط بوصفه حظرًا للخادم ولا توسيعًا لحق الوصول. إلغاءه يحتاج عملية نطاق موثقة على طبقة المنصة، لا حذف الموقع أو تغيير صلاحيات JWT/DB أو فرض Host عام على البروكسي الداخلي.

فحص 11:26 UTC بعد تفويض بوابة الوصول ثم OAuth التطبيق على الأصل الجديد: /api/session200 authenticated=true ودورadmin والهوية المعتمدة متطابقة، /api/admin/state200، adminGate مخفي وadminShell ظاهر. لم تُكتب بيانات عملاء أو يُعاد تثبيت المدير أو تعديل الإعدادات. تجميع الواجهة نجح وفحوص Pages-only routing الثلاثة نجحت، ولا إعادة نشر خادم لمجرد تحديث انتقال Pages.

## فتح الصفحة للزوار — 11:33 UTC

طلب المالك أن تفتح واجهة التجار للجميع، ولا يُطلب الإيميل إلا عند اختيار الدخول أو تسجيل الحساب. كان السبب visibility=owner وبوابة المنصة قبل التطبيق. طلب public عرض تأكيد المنصة، وأكمله المالك بنجاح؛ GET config/visibility أكد public/isPublished=true. لا إعادة نشر أو تغيير لمصادقة التطبيق. فحص HTTP بلا cookie: / أعاد200/عنوان تسويقات وlandingHeroTitle دون redirect، /admin.html يعرض واجهة الدخول200، /api/session200 authenticated=false، /api/admin/state و/api/workspaces رفضا401. ظهور هيكل صفحة الإدارة لا يمنح صلاحية أو يكشف سجلاتها.
