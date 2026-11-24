# User Guide — Invoicing Platform

> English first, then العربية below. Screenshots are not included — the
> steps name the exact buttons and pages.

## English

### Getting started

1. **Create your account** — open the app, click **Register**, and enter
   your name, business name, email and a password (at least 10
   characters). A business workspace is created for you automatically,
   with UAE tax rates already set up (Standard 5%, Zero-rated, Exempt).
2. **Set up your business** — go to **Settings → Business** and fill in
   your trading name, TRN, address, phone, email, bank details, invoice
   numbering and payment terms. Upload your logo and signature here
   (PNG, JPEG or WebP, up to 5 MB). Only owners and admins can edit
   this page.
3. **Add customers** — **Customers → New customer**. A company or an
   individual; name, email and phone are the essentials. The customer
   page shows their invoices, payments and outstanding balance, and you
   can export the customer list as CSV.
4. **Add products** — **Products → New item**. Name, SKU, unit and
   price. Group items into categories, or import many at once from a
   CSV (**Products → Import** — download the template first; rows that
   fail are listed, never silently skipped).

### Invoices

1. **Create** — **Invoices → New invoice**. Pick a customer, add lines
   (pick a product or type a custom description), set quantity, price,
   discount (% or fixed) and the tax rate per line. The preview on the
   right updates live and shows exactly what the PDF will look like.
   Tax can be entered inclusive or exclusive of VAT per line.
2. **Save draft** — the invoice is saved without a number. You can
   still edit it.
3. **Issue invoice** — the invoice gets its number (INV-0001, …), is
   frozen (no more edits — corrections go through credit notes), and a
   PDF is generated and stored.
4. **Send by email** — from the invoice page. The first successful send
   moves the invoice to **Sent**. If sending fails, the email stays in
   the queue with the error shown; retry it from **Emails**.
5. **Download / Print** — **Download PDF** gives you the stored PDF;
   **Print** opens a print view. Owners and admins can **Regenerate**
   the PDF if the template or business details changed.
6. **Void** — an issued invoice with no payments can be voided. An
   invoice with payments or credit notes cannot be voided — use a
   credit note instead.

### Payments

1. From an issued invoice, click **Record payment**, enter the amount,
   date and method (cash, card, bank transfer, cheque, other). Partial
   payments are fine — the balance updates and the status becomes
   **Partially paid**; paying the full balance marks it **Paid**.
   Overpaying is rejected.
2. **Receipt** — every payment has a printable receipt
   (**Payments → a payment → Receipt**).
3. **Refund** — owners and admins can refund a payment (a reason is
   required). A payment with refunds cannot be deleted — refund it
   instead.
4. **Delete payment** — owners and admins only; it restores the
   invoice balance.

### Quotations

1. **Create** — **Quotations → New quotation**, the same builder as
   invoices.
2. **Send quotation** — the customer can accept or reject it from their
   portal link (see below), or you can mark it accepted/rejected
   yourself. Expired quotations can be marked expired.
3. **Convert to invoice** — converts a sent or accepted quotation into
   a **draft** invoice (edit it, then issue it). A quotation can only
   be converted once.

### Credit notes

1. From an issued invoice, click **New credit note**. Pick the lines
   and quantities to credit; the price can be lowered but never raised.
2. The credit cannot exceed the invoice's outstanding balance. Issuing
   it reduces the balance immediately.
3. A fully credited invoice stays **Issued** with a note that it is
   resolved, not paid — it is never marked Paid.
4. **Cancel** a credit note to reverse it (owners and admins).

### Expenses

1. **Expenses → New expense** — title, date, amount, VAT amount,
   category, vendor, payment method, and an optional receipt (image or
   PDF, up to 5 MB).
2. **Categories** — **Expenses → Categories**. Office, Travel,
   Software, Utilities, Marketing and Other are seeded for you; add
   your own. Deleting a category keeps the expenses (they become
   uncategorised).
3. The list filters by date range, category and search, and shows the
   totals for the filtered set.

### Recurring invoices

1. **Recurring → New schedule** — pick a customer and lines, a
   frequency (weekly, monthly, quarterly, yearly or every N days) and
   a start date. Tick **Send automatically** to issue and email each
   invoice as it is generated.
2. **Run now** generates the next period's invoice immediately;
   **Run due schedules now** runs every schedule whose date has come.
   Each period produces exactly one invoice — running twice never
   duplicates it.
3. **Pause / Resume / Cancel** from the schedule page. A cancelled
   schedule never runs again. Month-end dates clamp (31 January →
   28 February) and do not snap back.
4. There is no automatic background scheduler yet — schedules run when
   someone clicks Run (see RUNBOOK.md).

### Customer portal

1. From an issued invoice or a sent quotation, open the **Customer
   portal** section and click **Create portal link**. Choose how many
   days the link stays valid (default 30, up to 365).
2. **Copy the link and send it to your customer yourself** (email,
   WhatsApp, …). The link is shown once — it is never stored in plain
   text and cannot be shown again.
3. Your customer opens the link with **no login**: they see the invoice
   and can download the PDF, or accept/reject a quotation.
4. **Revoke** a link any time (owners and admins) — a revoked link
   stops working immediately. Expired and revoked links all show the
   same "no longer valid" message.

### Reports

**Reports** has five reports, all computed from your invoices,
payments and expenses, so the totals always tie to the ledger:

- **Revenue** — invoiced vs paid vs credited vs outstanding, with a
  monthly breakdown.
- **VAT** — output VAT on issued invoices minus input VAT on expenses.
- **Overdue** — unpaid invoices past their due date, worst first.
- **Customer balances** — what each customer owes.
- **Product revenue** — quantity sold and revenue per product (revenue
  here is the VAT-inclusive line total, so it ties to the revenue
  report's invoiced figure).

Every report can be downloaded as **CSV** and printed. Use the date
range to look at a specific period.

### Dashboard

The dashboard shows this month's invoiced, paid and outstanding
amounts, plus charts for revenue over the last 6 months, outstanding
by status, and your top customers. Empty states mean "no data yet",
never demo numbers.

### Roles

- **Owner** — everything, including deleting the business and managing
  owners.
- **Admin** — everything except deleting the business and managing
  owners (can delete payments, revoke portal links, regenerate PDFs).
- **Member** — create and edit records in their area; cannot do
  owner/admin actions.
- **Viewer** — read-only.

### If something goes wrong

- **"Too many sign-in attempts"** — wait a minute and try again
  (login is rate-limited).
- **An email failed** — open **Emails**, read the error, and click
  **Retry**. After 3 failed attempts it stays failed — check the
  recipient address and your email provider settings.
- **A PDF won't download** — try **Regenerate** on the invoice page;
  if it still fails, tell the business owner (Chromium may be missing
  on the server).
- **A portal link doesn't work** — the link may have expired or been
  revoked; create a fresh one from the invoice page.

---

## العربية — دليل المستخدم

### البدء

1. **إنشاء حساب** — افتح التطبيق، واضغط **تسجيل**، وأدخل اسمك واسم
   شركتك وبريدك الإلكتروني وكلمة مرور (10 أحرف على الأقل). سيتم إنشاء
   مساحة عمل لشركتك تلقائيًا، مع معدلات الضريبة الإماراتية الجاهزة
   (الأساسية 5٪، والصفرية، والمعفاة).
2. **إعداد شركتك** — انتقل إلى **الإعدادات ← الشركة** واملأ الاسم
   التجاري والرقم الضريبي (TRN) والعنوان والهاتف والبريد الإلكتروني
   وبيانات البنك وترقيم الفواتير وشروط الدفع. ارفع شعارك وتوقيعك هنا
   (PNG أو JPEG أو WebP، حتى 5 ميغابايت). يمكن للمالكين والمسؤولين
   فقط تعديل هذه الصفحة.
3. **إضافة العملاء** — **العملاء ← عميل جديد**. شركة أو فرد؛ الاسم
   والبريد الإلكتروني والهاتف هي الأساسيات. تعرض صفحة العميل فواتيره
   ومدفوعاته ورصيده المستحق، ويمكنك تصدير قائمة العملاء كملف CSV.
4. **إضافة المنتجات** — **المنتجات ← عنصر جديد**. الاسم والرمز
   (SKU) والوحدة والسعر. يمكنك تجميع العناصر في فئات، أو استيراد
   العديد منها دفعة واحدة من ملف CSV (**المنتجات ← استيراد** — نزّل
   القالب أولًا؛ الصفوف التي تفشل تُعرض ولا تُتخطى بصمت).

### الفواتير

1. **إنشاء** — **الفواتير ← فاتورة جديدة**. اختر العميل، وأضف البنود
   (اختر منتجًا أو اكتب وصفًا مخصصًا)، وحدد الكمية والسعر والخصم
   (نسبة أو مبلغ ثابت) ومعدل الضريبة لكل بند. تتحدث المعاينة مباشرة
   وتعرض بالضبط ما سيظهر في ملف PDF. يمكن إدخال الضريبة شاملة أو
   غير شاملة لكل بند.
2. **حفظ كمسودة** — تُحفظ الفاتورة بدون رقم، ويمكنك تعديلها.
3. **إصدار الفاتورة** — تحصل الفاتورة على رقمها (INV-0001، …)،
   وتُجمَّد (لا مزيد من التعديلات — التصحيحات تتم عبر الإشعارات
   الدائنة)، ويُنشأ ملف PDF ويُحفظ.
4. **الإرسال بالبريد الإلكتروني** — من صفحة الفاتورة. أول إرسال
   ناجح ينقل الفاتورة إلى حالة **مُرسَلة**. إذا فشل الإرسال، يبقى
   البريد في القائمة مع الخطأ؛ أعد المحاولة من صفحة **البريد**.
5. **التنزيل / الطباعة** — **تنزيل PDF** يعطيك الملف المحفوظ؛
   و**الطباعة** تفتح عرضًا للطباعة. يمكن للمالكين والمسؤولين
   **إعادة إنشاء** ملف PDF إذا تغير القالب أو بيانات الشركة.
6. **الإلغاء** — يمكن إلغاء فاتورة صادرة بلا مدفوعات. الفاتورة التي
   عليها مدفوعات أو إشعارات دائنة لا يمكن إلغاؤها — استخدم إشعارًا
   دائنًا بدلًا من ذلك.

### المدفوعات

1. من فاتورة صادرة، اضغط **تسجيل دفعة**، وأدخل المبلغ والتاريخ
   والطريقة (نقدًا، بطاقة، تحويل بنكي، شيك، أخرى). الدفعات الجزئية
   مسموحة — يتحدث الرصيد وتصبح الحالة **مدفوعة جزئيًا**؛ وعند دفع
   كامل الرصيد تصبح **مدفوعة**. الدفع الزائد مرفوض.
2. **الإيصال** — لكل دفعة إيصال قابل للطباعة (**المدفوعات ← دفعة ←
   الإيصال**).
3. **الاسترداد** — يمكن للمالكين والمسؤولين استرداد دفعة (مع ذكر
   السبب). الدفعة التي عليها استردادات لا يمكن حذفها — استردها بدلًا
   من ذلك.
4. **حذف الدفعة** — للمالكين والمسؤولين فقط؛ ويعيد رصيد الفاتورة.

### عروض الأسعار

1. **إنشاء** — **عروض الأسعار ← عرض جديد**، بنفس منشئ الفواتير.
2. **إرسال العرض** — يمكن للعميل قبوله أو رفضه من رابط البوابة
   (انظر أدناه)، أو يمكنك تمييزه كمقبول/مرفوض بنفسك. العروض المنتهية
   يمكن تمييزها كمنتهية.
3. **التحويل إلى فاتورة** — يحوّل العرض المُرسَل أو المقبول إلى
   **فاتورة مسودة** (عدّلها ثم أصدرها). لا يمكن تحويل العرض إلا مرة
   واحدة.

### الإشعارات الدائنة

1. من فاتورة صادرة، اضغط **إشعار دائن جديد**. اختر البنود والكميات
   المراد إرجاعها؛ يمكن تخفيض السعر لا رفعه.
2. لا يمكن أن يتجاوز الإشعار الرصيد المستحق للفاتورة. إصداره يخفّض
   الرصيد فورًا.
3. الفاتورة المُرجَعة بالكامل تبقى **صادرة** مع ملاحظة أنها محلولة
   وليست مدفوعة — ولا تُميَّز كمدفوعة أبدًا.
4. **إلغاء** الإشعار الدائن يعكسه (للمالكين والمسؤولين).

### المصروفات

1. **المصروفات ← مصروف جديد** — العنوان والتاريخ والمبلغ ومبلغ ضريبة
   القيمة المضافة والفئة والمورّد وطريقة الدفع، مع إيصال اختياري
   (صورة أو PDF، حتى 5 ميغابايت).
2. **الفئات** — **المصروفات ← الفئات**. المكتب والسفر والبرمجيات
   والمرافق والتسويق وأخرى جاهزة لك؛ أضف فئاتك الخاصة. حذف فئة
   يُبقي المصروفات (تصبح بلا فئة).
3. القائمة تُصفى حسب نطاق التاريخ والفئة والبحث، وتعرض إجماليات
   المجموعة المصفاة.

### الفواتير المتكررة

1. **المتكررة ← جدول جديد** — اختر العميل والبنود، والتكرار
   (أسبوعي، شهري، ربع سنوي، سنوي، أو كل N أيام) وتاريخ البدء.
   فعّل **الإرسال التلقائي** لإصدار كل فاتورة وإرسالها بالبريد عند
   إنشائها.
2. **التشغيل الآن** ينشئ فاتورة الفترة التالية فورًا؛ و**تشغيل
   الجداول المستحقة الآن** يشغّل كل جدول حلّ موعده. كل فترة تنتج
   فاتورة واحدة بالضبط — التشغيل مرتين لا يكررها أبدًا.
3. **إيقاف / استئناف / إلغاء** من صفحة الجدول. الجدول الملغى لا
   يعمل مجددًا أبدًا. تواريخ نهاية الشهر تُضبط (31 يناير ← 28 فبراير)
   ولا تعود.
4. لا يوجد مُجدوِل خلفية تلقائي بعد — تعمل الجداول عندما يضغط
   أحدهم زر التشغيل (انظر RUNBOOK.md).

### بوابة العميل

1. من فاتورة صادرة أو عرض سعر مُرسَل، افتح قسم **بوابة العميل**
   واضغط **إنشاء رابط بوابة**. اختر عدد الأيام التي يبقى فيها الرابط
   صالحًا (الافتراضي 30، حتى 365).
2. **انسخ الرابط وأرسله إلى عميلك بنفسك** (بريد إلكتروني، واتساب، …).
   يُعرض الرابط مرة واحدة فقط — فهو لا يُحفظ كنص صريح ولا يمكن
   عرضه مجددًا.
3. يفتح العميل الرابط **بدون تسجيل دخول**: يرى الفاتورة ويمكنه تنزيل
   ملف PDF، أو قبول عرض السعر أو رفضه.
4. **ألغِ** الرابط في أي وقت (للمالكين والمسؤولين) — يتوقف الرابط
   الملغى عن العمل فورًا. الروابط المنتهية والملغاة تعرض جميعها
   رسالة "غير صالح" نفسها.

### التقارير

**التقارير** تضم خمسة تقارير، كلها محسوبة من فواتيرك ومدفوعاتك
ومصروفاتك، فتتطابق إجمالياتها دائمًا مع الدفاتر:

- **الإيرادات** — المُفوتر مقابل المدفوع مقابل المُرجَع مقابل
  المستحق، مع تفصيل شهري.
- **ضريبة القيمة المضافة** — ضريبة المخرجات على الفواتير الصادرة
  ناقص ضريبة المدخلات على المصروفات.
- **المتأخرة** — الفواتير غير المدفوعة بعد تاريخ استحقاقها، الأسوأ
  أولًا.
- **أرصدة العملاء** — ما يدين به كل عميل.
- **إيرادات المنتجات** — الكمية المباعة والإيراد لكل منتج (الإيراد هنا
  هو إجمالي البند شاملًا الضريبة، فيتطابق مع رقم الفوترة في تقرير
  الإيرادات).

يمكن تنزيل كل تقرير كملف **CSV** وطباعته. استخدم نطاق التاريخ لعرض
فترة محددة.

### لوحة التحكم

تعرض لوحة التحكم مبالغ الشهر الحالي المُفوترة والمدفوعة والمستحقة،
بالإضافة إلى رسوم بيانية للإيرادات خلال آخر 6 أشهر، والمستحق حسب
الحالة، وأفضل عملائك. الحالات الفارغة تعني "لا بيانات بعد"، وليست
أرقامًا تجريبية أبدًا.

### الأدوار

- **المالك** — كل شيء، بما في ذلك حذف الشركة وإدارة المالكين.
- **المسؤول** — كل شيء ما عدا حذف الشركة وإدارة المالكين (يمكنه
  حذف المدفوعات وإلغاء روابط البوابة وإعادة إنشاء ملفات PDF).
- **العضو** — إنشاء وتعديل السجلات في مجاله؛ لا يمكنه تنفيذ إجراءات
  المالك/المسؤول.
- **المشاهد** — قراءة فقط.

### عند حدوث مشكلة

- **"محاولات تسجيل دخول كثيرة جدًا"** — انتظر دقيقة وحاول مجددًا
  (تسجيل الدخول محدود المعدل).
- **فشل بريد إلكتروني** — افتح **البريد**، واقرأ الخطأ، واضغط
  **إعادة المحاولة**. بعد 3 محاولات فاشلة يبقى فاشلًا — تحقق من
  عنوان المستلم وإعدادات مزود البريد.
- **ملف PDF لا يُنزَّل** — جرّب **إعادة الإنشاء** من صفحة الفاتورة؛
  وإذا استمر الفشل، أخبر مالك الشركة (قد يكون Chromium مفقودًا على
  الخادم).
- **رابط بوابة لا يعمل** — قد يكون الرابط منتهيًا أو ملغيًا؛ أنشئ
  رابطًا جديدًا من صفحة الفاتورة.
