import VoxelGame from '@/components/game/VoxelGame'

// Static, SSR-rendered loading shell:
// - appears instantly from HTML, even before/if JavaScript downloads (slow phones, flaky networks)
// - VoxelGame removes it as soon as React mounts
// - if JS never arrives or the game crashes, an inline script swaps in a manual-retry hint
// - no dynamic import → no silent "stuck on loading" failure mode
export default function Page() {
  return (
    <>
      <div
        id="bc-shell"
        dir="rtl"
        className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-5 bg-gradient-to-b from-[#2a3a52] to-[#141a24] px-6 text-center"
      >
        <h1 className="text-3xl font-black text-white drop-shadow-[0_3px_0_rgba(0,0,0,0.45)]">بلاک کرَفت</h1>
        <div className="flex gap-2">
          <span className="h-4 w-4 animate-bounce rounded-[3px] bg-emerald-500" style={{ animationDelay: '0s' }} />
          <span className="h-4 w-4 animate-bounce rounded-[3px] bg-emerald-500" style={{ animationDelay: '0.15s' }} />
          <span className="h-4 w-4 animate-bounce rounded-[3px] bg-emerald-500" style={{ animationDelay: '0.3s' }} />
        </div>
        <div id="bc-shell-msg" className="text-base font-bold text-white/85">در حال بارگذاری بازی…</div>
        <div className="max-w-xs text-xs leading-6 text-white/45">
          اگر بیش از ۳۰ ثانیه طول کشید، صفحه را دوباره بارگذاری کنید یا از مرورگر کروم استفاده کنید.
        </div>
      </div>
      <noscript>
        <div style={{ position: 'fixed', inset: 'auto 0 0 0', zIndex: 90, padding: 12, textAlign: 'center', background: '#1d232b', color: '#fff', fontFamily: 'sans-serif' }}>
          برای اجرای بازی باید جاوااسکریپت مرورگر روشن باشد.
        </div>
      </noscript>
      <script
        dangerouslySetInnerHTML={{
          __html:
            "setTimeout(function(){var m=document.getElementById('bc-shell-msg');if(m){m.textContent='بارگذاری بیش از حد طول کشید — صفحه را دوباره باز کنید (کشیدن به پایین برای نوسازی)';m.className='text-base font-bold text-amber-300'}},20000)"
        }}
      />
      <VoxelGame />
    </>
  )
}
