import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "شروط الاستخدام | محاضر" }] }),
  component: Terms,
});

function Terms() {
  return (
    <main dir="rtl" className="mx-auto max-w-3xl space-y-5 px-4 py-10 text-sm leading-relaxed">
      <h1 className="font-display text-2xl font-bold">شروط الاستخدام</h1>
      <p className="text-xs text-muted-foreground">نسخة 2026-10 — مسودة تشغيلية تحتاج مراجعة مستشار قانوني قبل الإطلاق في كل سوق مستهدف.</p>
      <section className="space-y-2">
        <h2 className="font-bold">1. الملفات المرفوعة وحقوق الملكية</h2>
        <p>تبقى ملكية ما ترفعه لك أو لصاحبه الأصلي. بالرفع تُقرّ بأنك تملك حق استخدام الملف أو مرخّص لك باستخدامه لأغراض دراستك الشخصية، وأنك لن ترفع مواد محمية لإعادة توزيعها.</p>
        <p>تمنحنا ترخيصاً محدوداً لمعالجة الملف فقط لتوليد المحتوى الدراسي لك. لا نستخدم ملفاتك لتدريب نماذج عامة ولا نعرضها لمستخدمين آخرين إلا عبر مساحة معلم/جامعة تفعّلها أنت.</p>
      </section>
      <section className="space-y-2">
        <h2 className="font-bold">2. الحذف والاحتفاظ</h2>
        <p>تُحذف الملفات الأصلية تلقائياً بعد انتهاء مدة الاحتفاظ التي تختارها (الافتراضي 365 يوماً)، ويمكنك حذفها فوراً في أي وقت من إعدادات الحساب. المحتوى المولَّد يبقى لك حتى تحذف الدورة.</p>
      </section>
      <section className="space-y-2">
        <h2 className="font-bold">3. القاصرون</h2>
        <p>من هم دون سن الرشد في بلدهم يحتاجون موافقة ولي الأمر قبل رفع الملفات.</p>
      </section>
      <section className="space-y-2">
        <h2 className="font-bold">4. دقة المحتوى</h2>
        <p>المحتوى مبني على مصادرك مع إسناد لكل معلومة، لكنه قد يحتوي أخطاءً؛ ما يُعلَّم «بحاجة لمراجعة» يجب مطابقته بالمصدر. لا يُغني عن المرجع الأصلي.</p>
      </section>
      <section className="space-y-2">
        <h2 className="font-bold">5. الدفع</h2>
        <p>الاشتراكات تتجدد حتى الإلغاء. باقات الامتحان دفعة واحدة وصالحة للمدة المعلنة ولا تتجدد.</p>
      </section>
      <Link to="/" className="underline">العودة</Link>
    </main>
  );
}
