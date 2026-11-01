/* Meraify landing page
   EDIT THIS BLOCK to wire up your site. Everything else can stay as is. */
const CONFIG = {
  // Set debug to false when you launch. While true, a link you haven't filled in
  // shows a note telling you which one it is; when false it just says "Coming soon".
  debug: true,

  // Where every button goes. Use a full URL ("https://...") or a path ("index.html").
  // Leave "" to keep a button inactive for now.
  links: {
    try: "tool.html",            // "Try for free" buttons: your app
    app: "tool.html",            // "Open in your browser"
    login: "",                    // "Log in"
    downloadMac: "",              // "Download for Mac"
    downloadWindows: "",          // "Download for Windows"
    about: "",                    // "About us"
    changelog: "", careers: "", press: "", contact: "",
    support: "", privacy: "", terms: ""
  },

  // Your three images. Put a path or URL in src (like "img/hero.jpg"); leave "" to keep the empty frame.
  images: {
    hero:     { src: "", alt: "Meraify reading a document aloud" },
    feature:  { src: "", alt: "Following along as Meraify reads" },
    download: { src: "", alt: "Meraify on your desktop" }
  }
};

/* ---------- Links ---------- */
(function () {
  var toast = document.createElement("div");
  toast.className = "toast glass"; toast.setAttribute("role", "status");
  document.body.appendChild(toast);
  var timer;
  function say(msg) {
    toast.textContent = msg; toast.classList.add("on");
    clearTimeout(timer); timer = setTimeout(function () { toast.classList.remove("on"); }, 2600);
  }
  document.querySelectorAll("[data-link]").forEach(function (a) {
    var key = a.dataset.link, url = (CONFIG.links[key] || "").trim();
    if (url) {
      a.href = url;
      if (/^https?:\/\//i.test(url) && url.indexOf(location.origin) !== 0) { a.target = "_blank"; a.rel = "noopener"; }
    } else {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        say(CONFIG.debug ? "No link set for \u201c" + key + "\u201d yet. Add it in landing.js." : "Coming soon.");
      });
    }
  });
})();

/* ---------- Images ---------- */
(function () {
  document.querySelectorAll("[data-slot]").forEach(function (slot) {
    var c = CONFIG.images[slot.dataset.slot];
    if (c && c.src) {
      var img = new Image(); img.src = c.src; img.alt = c.alt || ""; img.loading = "lazy"; img.decoding = "async";
      slot.appendChild(img);
    }
  });
})();

/* ---------- Mobile menu ---------- */
(function () {
  var btn = document.getElementById("menu"), drawer = document.getElementById("drawer");
  if (!btn || !drawer) return;
  function set(open) { drawer.hidden = !open; btn.setAttribute("aria-expanded", open); btn.setAttribute("aria-label", open ? "Close menu" : "Open menu"); }
  btn.addEventListener("click", function () { set(drawer.hidden); });
  drawer.addEventListener("click", function (e) { if (e.target.closest("a")) set(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") set(false); });
  addEventListener("resize", function () { if (innerWidth > 860) set(false); });
})();

/* ---------- Flower field and sky ---------- */
(function(){
  var s=11;function r(){s|=0;s=s+0x6D2B79F5|0;var t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}
  var P=['#f4b6c8','#f2a7a0','#f8c9a4','#f6dca4','#d6c8f2','#efd9ee'];
  function field(id,n,minH,maxH,minR,maxR){
    var o=[];
    for(var i=0;i<n;i++){
      var x=r()*1440,h=minH+r()*(maxH-minH),R=minR+r()*(maxR-minR),top=400-h,lean=(r()-.5)*60,bend=(r()-.5)*40,c=P[Math.floor(r()*P.length)],pet='';
      for(var k=0;k<6;k++)pet+='<ellipse cx="0" cy="'+(-R*.85)+'" rx="'+(R*.52)+'" ry="'+R+'" transform="rotate('+(k*60)+')" fill="'+c+'" fill-opacity=".85"/>';
      o.push('<g class="sw" style="transform-origin:'+x.toFixed(0)+'px 400px;animation-delay:-'+(r()*9).toFixed(1)+'s;animation-duration:'+(7+r()*5).toFixed(1)+'s">'+
        '<path d="M'+x.toFixed(1)+' 410Q'+(x+bend).toFixed(1)+' '+(400-h/2).toFixed(1)+' '+(x+lean).toFixed(1)+' '+top.toFixed(1)+'" stroke="#a9c7ae" stroke-opacity=".7" stroke-width="'+(1.5+R/14).toFixed(1)+'" fill="none" stroke-linecap="round"/>'+
        '<g transform="translate('+(x+lean).toFixed(1)+' '+top.toFixed(1)+') rotate('+((r()-.5)*40).toFixed(0)+')">'+pet+'<circle r="'+(R*.34).toFixed(1)+'" fill="#fff1c4"/></g></g>');
    }
    document.getElementById(id).innerHTML=o.join('');
  }
  field('fb',22,110,260,12,20);field('ff',30,50,200,10,22);
  var root=document.documentElement,tick=false;
  function upd(){tick=false;var m=root.scrollHeight-innerHeight;root.style.setProperty('--t',m>0?Math.min(1,scrollY/m).toFixed(3):0)}
  addEventListener('scroll',function(){if(!tick){tick=true;requestAnimationFrame(upd)}},{passive:true});upd();
})();
