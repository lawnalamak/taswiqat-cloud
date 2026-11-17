# عقد Backend — تسويقات

Node 22 ES modules، Express 4، MySQL مدارة. كل الخطأ JSON `{error:{code,message}}`، ولا توجد هويات أو تكاملات أو مدفوعات وهمية. نُفّذت المهاجرات v2 وإعداد المدير الخاص وتثبيت هويته بعد OAuth فعلي؛ لا حاجة لإعادتها عند تشغيل الخادم.

الرابط التشغيلي المختصر منذ 17 نوفمبر 2026: https://taswiqat.manus.space، والإدارة /admin.html، وcallback تسجيل التطبيق https://taswiqat.manus.space/api/auth/callback. تغيير النطاق الفرعي لم يغير الإصدار المنشور869108e. في 11:33 UTC اعتمد المالك رؤية public لإزالة بوابة الإيميل قبل تصفح الصفحة؛ هذا لا ينشئ جلسة تطبيق ولا يفتح بيانات النشاط أو API الإدارة. الأصول في عقود OAuth أدناه تؤخذ من أصل المتصفح الفعلي، لا من اسم النطاق السابق في أدلة الاختبارات التاريخية.

## التشغيل

`node backend/migrate.mjs` مهاجرات إضافية versioned لجداول `taswiqat_*` فقط، دون تعديل جداول قديمة، defaults عبر INSERT IGNORE، ويغلق pool. `printf '%s\n' "$ADMIN_EMAIL" | node backend/configure-admin.mjs` يكتب البريد في singleton خاص DB. تغيير/إعادة تثبيت الهوية يتطلب `--change`، يزيل pin القديم ويخفض المدير القديم، ولا يمنح البريد دورًا إلا بعد OAuth GetUserInfo موثّق. `node backend/app.mjs` على `0.0.0.0:${PORT:-3000}`، لا يشغّل مهاجرات تلقائيًا.

المتغيرات اللازمة: `DATABASE_URL`, `MANUS_JWT_SECRET`, `MANUS_PROJECT_ID`, `MANUS_OAUTH_PORTAL_URL`, `MANUS_OAUTH_API_URL`. للرفع `MANUS_API_URL` و`MANUS_API_KEY`. لا يُرسل أي secret إلى المتصفح. اختياري: `TASWIQAT_PUBLIC_ORIGINS` قائمة origins HTTPS مفصولة بفواصل، `TASWIQAT_TRUST_PROXY=true` لقبول host الممرر من reverse proxy موثوق فقط عند `X-Forwarded-Proto: https`، `TASWIQAT_ALLOW_LOCALHOST=true` يدعم localhost HTTP دون تعطيل JWT أو صلاحيات.

## الجلسة والطلبات

- `GET /api/health`: readiness حقيقية DB + migration + جميع الجداول + singleton الإعداد والإصدار؛ 200 عند الجاهزية أو 503 دون DSN/errors حساسة.
- `GET /api/session`: `{authenticated:false}` لغياب/انتهاء الجلسة، أو `{authenticated:true,user:{id,name,email,role:'admin'|'user'},workspaces:[{id,name,role:'owner'|'manager'|'employee',status}],workspaceId,csrfToken}`. admin من DB وpin فقط. JWT بريد/role لا يمنحان صلاحيات.
- `GET /api/auth/start?origin=<window.location.origin>&target=app|admin`: `{url}` لـManus OAuth؛ redirectUri مضبوط على أصل المتصفح `/api/auth/callback`. Cookie state موقعة وnonce random أحادية الاستخدام مخزنة DB؛ لا تخمين Host في OAuth. يعتمد قبول callback النهائي على سياسة portal.
- `GET /api/auth/callback?code=...&state=...`: ExchangeToken ثم GetUserInfo، upsert بـopenId، session cookie `webdev_app_session` HS256 مع exp/appId/openId. Secure SameSite=None على HTTPS. التحويل فقط إلى `/#app` أو `/admin.html` للمثبت admin.
- جميع API الخاصة تتطلب cookie؛ كل طلب unsafe الخاص يتطلب `X-CSRF-Token` من `/api/session`؛ الرمز HMAC مشتق من session وليس من localStorage. ناقلا العميل والإدارة يرسلان أيضًا `X-Taswiqat-Origin: window.location.origin`. الأصل يجب أن يطابق origin الجلسة، أو قائمة الأصل الفعلي/المضيف الموثوق في Preview. لا CORS wildcard.
- استثناء إعادة كتابة Origin في المعاينة محدود: عند HMAC صحيح وأصل HTTPS متحقق، يُقبل بدل الأصل الداخلي فقط إذا socket loopback وOrigin هو HTTP loopback مطابق Host تمامًا. null أو مصدر خارجي أو peer خارجي أو أصل متصفح مخالف يظل مرفوضًا. ليس هذا trust-proxy عامًا أو تجاوزًا للمصادقة.
- `POST /api/auth/logout`: CSRF، `{ok:true}` مع إلغاء hash الجلسة DB ومسح cookie.

## مساحات العملاء

معرّفات القنوات الحالية: `ig,tt,x,sc,wa,fb,gbp,ga4,gads,yt,gsc`، لا تكرار. state:

```js
{ business:{name,type,market,website,bio}, selected:[],
  posts:[{id,title,text,channels:[],media:null /* أو {name,type,data} أو {name,type,url} */,
          campaignId:null,scheduledFor:null,status:'draft'|'review'|'ready'|'planned',
          author:'<actual user.id>',updatedAt:'<ISO datetime>'}],
  campaigns:[{id,name,description?,startDate?,endDate?,status?,budget?,channels?,goal?}],
  team:[{id,name,email,role:'owner'|'manager'|'employee',status:'active'|'suspended'}],theme:'light'|'dark'}
```

`author` هو معرّف المستخدم الحقيقي وليس `merchant`/`employee`. team مصفوفة مشتقة من memberships للقراءة؛ احتفظ بها كما أعادها GET عند PUT، إدارة الفريق عبر invitations فقط. website فارغ أو HTTPS. media dataURL allowlist JPEG/PNG/WebP/GIF/MP4/WebM، فحص magic signature وحجم decoded ≤3 MiB، لا SVG/HTML. media URL يجب أن يكون `/manus-storage/taswiqat/...` مفهرسًا ومملوكًا لنفس workspace؛ لا روابط عشوائية. حدود state12MiB، posts500، campaigns100، نص المنشور20000، الأعمال160/80/160/2048/2000.

- `POST /api/workspaces {business,selected}` → 201 `{workspaceId,state,version:1,role:'owner'}` مع subscription trial14 يومًا basic، لا payment؛ 10 مساحات مملوكة كحد أقصى.
- `GET /api/workspaces/:id/state` → `{state,version,role,workspaceId,connections:[],subscription,plan}`.
- `PUT /api/workspaces/:id/state {state,version}` → `{state,version}` canonical بعد تحقق الدور والحصص. 409 version_conflict لا كتابة عمياء. owner/manager يديران المحتوى؛ employee يغيّر منشوراته draft/review فقط، لا منشورات الآخرين أو المعتمد/المخطط، ولا author/إعدادات/campaigns/team/selected/theme. لا نشر خارجي لحالة planned.
- `GET /api/workspaces/:id/team` للإدارة → `{members:[],invitations:[]}`.
- `POST /api/workspaces/:id/invitations {name,email,role:'manager'|'employee'}` → `{invitation,token,path:'/#invite/<token>',emailSent:false}`؛ نسخ يدوي لا إرسال بريد. token hash فقط DB، expiry7 أيام، quota تشمل الدعوات المعلّقة.
- `POST /api/invitations/accept {token}` → `{workspaceId,role}` فقط إذا بريد DB الموثّق من GetUserInfo يطابق email الدعوة؛ single-use transactional.
- `POST /api/workspaces/:id/tickets {subject,message}` → 201 `{ticket}`، حد10 يوميًا لكل مستخدم. `GET` نفس المسار يعطي `{tickets}` للإدارة أو تذاكر المستخدم نفسه للموظف.
- `POST /api/workspaces/:id/media {name,type,data}` → 201 `{media:{name,type,url,id,size}}` رفع خادم إلى التخزين الحقيقي ثم فهرس DB ownership؛ 503 إذا الخدمة غير مهيأة، 502 عند فشلها. ملفات التخزين ليست خاصة لكل عضو عند معرفة URL؛ العزل مفروض على الرفع والفهرس والاستخدام، ولا ادعاء physical delete.

## الإدارة والموقع

- `GET /api/public/settings` → `{site,plans}` من DB. defaults site: heroLine1 `كل قنواتك.`، heroLine2 `مكان واحد.`، وصف عربي عام، contactEmail/notice فارغان. basic199/2channels/1member، pro449/5/5، enterprise899/11/20. prices مقترحة وليست مدفوعات.
- `GET /api/admin/state` → `{state:{workspaces,users,subscriptions,plans,connections,operations,tickets,audit,site,settings},version}`، يتطلب admin من DB وpin. مصفوفات العملاء والإدارة هي نفس الصفوف وليست local mocks.
- `PUT /api/admin/state {state,version}` → `{state,version}`؛ revision global يتغير مع جميع mutations، 409 عند أي تغيير متداخل، يحفظ تعديلات حقيقية ويعيد normalized snapshot. لا frontend-supplied openId أو إنشاء users، ولا ترقية admins؛ roles/openId/users email غير قابل للتغيير من payload. إضافة workspace provisioning تحتاج مالكًا موجودًا ذا بريد OAuth موثّق، لا first-login grants.

تفاصيل أعمدة الإدارة النهائية والاختبارات تضاف هنا عند اكتمال التنفيذ.

## التكاملات وstatic

كل `/api/oauth/*` محفوظ، بما فيه `/api/oauth/google/connect`, `/api/oauth/meta/connect`, `/api/oauth/tiktok/connect`, `/api/oauth/snapchat/connect`, `/api/oauth/x/connect`، ويرد 503 `integration_not_configured` إلى حين تركيب راوتر الوكيل المختص. publisher capabilities false ولا successful connect/publish/paid مختلق. الخادم يخدم dist وadmin.html وmanus-routes.json بأمان؛ API غير مسجل404 JSON ولا SPA masking.

نقطة تركيب المنصات الفعلية هي موضع حارس503 في `backend/app.mjs` قبل مرشح API العام. الراوتر الجديد يجب أن يفرض `authenticate` وعضوية workspace owner/manager وCSRF قبل بدء اتصال/إجراء يغيّر البيانات؛ callback العام إن لزم يتحقق من state/nonce أحادية الاستخدام المرتبطة بالمستخدم والمساحة قبل أي تبادل. لا تعطيل المصادقة لبقية API. الرموز في خادم/تخزين مشفر لا في state العميل، وconnections مشتقة من اتصال خارجي موثّق لا من selected أو URL. تغييرات الجداول مهاجرات إضافية versioned، لا تعديل مخطط PostgreSQL القديم أو إسقاط بيانات MySQL. تفاصيل موفّري المنصات للوكيل الثاني فقط؛ إدارة النظام والجدولة والعامل والدفع لبقية النظام.

### تنسيق سجلات الإدارة المنفّذ (للوكيل المسؤول عن admin.js)

السجلات الجديدة UUID، وaudit.id UUID ثابت مشتق من sequence. Plans تستخدم `enabled` وليس `active` في API (داخل DB active). users جميع هويات الدخول الفعلية **بما فيها المدير دون نشاط**: `{id,name,email,workspaceId:'<first membership or empty>',role:'admin'|'user',status:'active'|'suspended'|'archived',createdAt,updatedAt}`. يجب أن يقبل validator الواجهة `workspaceId:''` وrole `user`، ولا يُجبر المستخدم على امتلاك مساحة عمل أو ينشئ أسماء/بريدًا وهميًا. بريد/name قد يكون فارغًا إذا GetUserInfo لم يقدمه. تعديل user يسمح name/status فقط، لا email/role/workspaceId أو إنشاء هوية جديدة. النموذج يعرض حقول الهوية للقراءة فقط.

workspaces `{id,name,businessType,ownerEmail,ownerId,planId,status:'trial'|'active'|'suspended'|'archived',notes,createdAt,updatedAt}`. `ownerEmail` موثّق وثابت، وقد يكون فارغًا عند عدم توفر البريد. الإنشاء provisioning يتطلب مالكًا حقيقيًا مسجّلًا ببريد موثّق، وإلا409 verified_owner_required؛ لا مستخدم جديد مختلق. type حد120، name160.

subscriptions `{id,workspaceId,planId,startDate,endDate,status:'trial'|'active'|'suspended'|'cancelled'|'expired',notes,manual:true,createdAt,updatedAt}`. تعديل planId يجب أن يطابق planId مساحة العمل في نفس snapshot. السجل يُنشأ تلقائيًا مع المساحة، لا إضافة اشتراك ثاني لنفس workspace. الحالة active تعني تفعيلًا يدويًا لا إثبات دفع. لا عمود revenue أو paid.

tickets `{id,workspaceId,userId,title,description,priority:'low'|'normal'|'high'|'urgent',assignee,status:'open'|'in_progress'|'resolved'|'closed',createdAt,updatedAt}`، title240 وdescription10000 توافق تذاكر العملاء. الإنشاء الإداري يحتاج workspace حقيقية (لا فارغة)، userId يختاره الخادم. يمكن تعديل title/description/priority/assignee/status لكن الملكية ثابتة.

إزالة صف من payload لا تحذف DB: users/workspaces تُؤرشف؛ subscriptions cancelled؛ tickets closed؛ plans disabled. آخر مدير مثبت محمي من الإزالة/التعليق/خفض الدور. canonical يعيد الصف المؤرشف، لذلك يجب أن يوضح frontend أن الإزالة أرشفة وليست حذفًا. connections/operations/audit read-only ويجب تمريرها كما جاءت بدون إضافة log متصفّح. العمليات مشتقة فقط من posts planned، مع dispatchEnabled:false/published:false.

settings المسموحة فقط `{theme?,supportHours?,registrationEnabled?,trialDays?}`؛ لا secrets. Site/plan defaults persistence INSERT IGNORE؛ admin changes تظهر في GET public. `GET /api/public/settings` وحده يحمل `Access-Control-Allow-Origin:*` (دون credentials) كي يقرأ موقع GitHub Pages التسويقي من APP_URL الفعلي. بقية API لا CORS عام.

## أدلة التحقق وحدود التسليم

التنفيذ في `backend/app.mjs, db.mjs, auth.mjs, migrate.mjs, configure-admin.mjs, validation.mjs, workspaces.mjs, admin.mjs, storage.mjs`، ويصدّر `createApp`, `start`, والوحدات pure للاختبار. المهاجرات الحالية v1 (الجداول/defaults) وv2 (حقول admin_json إضافية)، والتهيئة منفصلة عن startup.

اختبارات `tests/backend*.test.mjs` تغطي توقيع/expiry/appId JWT، fail-closed، عدم تصديق role/email claims، المستخدم المعلّق، منطق CLI تغيير المدير، CSRF ومطابقة origins، GET session logged-out، عزل workspace، 409 stale version دون UPDATE، الموظف/المؤلف، dataURL signatures والحجم والروابط الآمنة، حصص الدعوات، حماية آخر مدير، public CORS المحدود، static/path404، integration503. fixtures offline؛ الاختبار المتصل بقاعدة البيانات SELECT فقط. أحدث إعادة فحص لمسارات الإدارة والمصادقة المتأثرة نجحت18/18، بما فيها إصلاح بروكسي Origin واختبارات رفض التحايل.

الصحة الفعلية بعد المهاجرات200: `{ready:true,database:true,schema:true,schemaVersion:2}`. TLS المدارة يدعم DSN `ssl={"rejectUnauthorized":true}` مع تحقق الشهادة. دعم GET_LOCK/RELEASE_LOCK تحقق فعليًا. اختبار presign/get الحقيقي أعاد HTTP200 دون طباعة URL أو رفع أي ملف؛ هذا يثبت presign فقط **ولا يدعي** تجربة PUT أو العرض في المتصفح.

OAuth الفعلي وnonce/cookie نجحا في المتصفح، وثُبّت openId للمدير من GetUserInfo. session/admin GET200 ودورadmin حقيقي. حفظ snapshot بالقيم نفسها عبر `adminRequest` نجح ورفع revision2 إلى3، والطلب بلاCSRF والمصدر المزور رُفضا403. نشر الإصلاح869108eeeb05a7d2f7b6b6e75df5315b2f8f84f3 تأكد على https://taswiqat-ayt7ghj3.manus.space؛ OAuth التطبيق الفعلي هناك نجح أيضًا، health/session/admin200، وحفظ الإدارة المنشور نجح revision4 إلى5. بقي سجل مستخدم فعلي واحد وصفر أنشطة دون seed أو تغيير الموقع. التطبيق خاص بالمالك حاليًا؛ Public يختاره المالك من بطاقة النشر. Preview JWT غير المرتبط يبقى authenticated:false. في proxy مختلف لا تُفعّل trust-proxy إلا إذا كانت forwarded headers مستبدلة من وسيط موثوق.

لم تُنفّذ social OAuth أو publishing أو scheduling worker أو الدفع أو إرسال دعوات بالبريد. subscription trial/active سجل وصول يدوي وليس collection أو paid. الرفع actual runtime API implementation، لكن roundtrip رفع/حفظ ملف حقيقي ينتظر اختبار مستخدم مخوّل؛ مسار dataURL الآمن مستقل ومدعوم. إذا نُجح PUT التخزين ثم فشلت المعاملة يمكن أن يبقى object غير مفهرس؛ runtime API لا يوفر delete فلا ادعاء إزالة فعلية. keys غير قابلة للتخمين وupload/index/use authorization، لكن من يعرف stable media URL يستطيع قراءة object عبر المنصة؛ هذا ليس ACL تخزين خاصًا لكل مستخدم.

مدة التجربة default14 يومًا وتقرأ settings.trialDays عند إنشاء workspace جديدة؛ registrationEnabled=false يمنع إنشاء هويات دخول جديدة عادية في callback لكنه لا يمنع المدير المسموح أو دخول مستخدم موجود. supportHours/theme إعدادات إدارة وصفية دائمة، لا أسرار. سجلات audit append-only؛ الرد يعرض أحدث1000 فقط، ولا حذف قديم ولا تدقيق متصفح. rate limit داخل instance وليس موزعًا؛ لا daemon/background worker للتنظيف/النشر، ولا حذف user/workspace فعلي. خطة توسيع التشغيل متعددة instances أو retention بحاجة عمل منفصل، دون اختلاق خدمة تعمل الآن.
