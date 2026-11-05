import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "الخصوصية | محاضر" }] }),
  component: Privacy,
});

function Privacy() {
  return (
    <main dir="rtl" className="mx-auto max-w-3xl space-y-5 px-4 py-10 text-sm leading-relaxed">
      <h1 className="font-display text-2xl font-bold">سياسة الخصوصية</h1>
      <p className="text-xs text-muted-foreground">نسخة 2026-10 — مسودة تحتاج مراجعة قانونية وفق أنظمة حماية البيانات في أسواقك (نظام حماية البيانات الشخصية السعودي، قانون حماية البيانات المصري، GDPR عند خدمة مستخدمين أوروبيين).</p>
      <section className="space-y-2"><h2 className="font-bold">ما نجمعه</h2><p>البريد والاسم، سنة الميلاد (للتحقق من القاصرين)، الملفات التي ترفعها، ونشاطك الدراسي، وسجلات استهلاك الذكاء الاصطناعي.</p></section>
      <section className="space-y-2"><h2 className="font-bold">المعالجون</h2><p>مزوّد قاعدة البيانات والتخزين، مزوّد نماذج الذكاء الاصطناعي والصوت (تُرسل إليه نصوص الدرس فقط)، وبوابات الدفع. لا نبيع بياناتك.</p></section>
      <section className="space-y-2"><h2 className="font-bold">حقوقك</h2><p>الاطلاع والتصحيح والحذف. يمكنك حذف كل ملفاتك المرفوعة فوراً من الإعدادات، وطلب حذف الحساب كاملاً عبر الدعم.</p></section>
      <section className="space-y-2"><h2 className="font-bold">الاحتفاظ</h2><p>الملفات الأصلية تُحذف تلقائياً بعد المدة التي تحددها (الافتراضي 365 يوماً).</p></section>
      <Link to="/" className="underline">العودة</Link>
    </main>
  );
}
