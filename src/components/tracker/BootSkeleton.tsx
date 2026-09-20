// Каркас трекера на те доли секунды, пока данных ещё нет.
//
// Слова Кирилла 20.09.2026: «при запуске приложения сперва появляется
// чёрный экран и в левом верхнем углу слово „Загрузка…“». Именно это здесь
// и стояло — `<div style={{padding:24}}>Загрузка…</div>`, — и выглядело
// ровно так, как он описал: пустота с надписью в углу, из которой не
// понять, открылось приложение или сломалось.
//
// Данные к этому моменту и правда ещё не приехали (роль, задачи, встречи),
// и ускорить их дальше некуда — они уже приходят из локальной копии первым
// кадром. Чего не хватало, так это самого кадра: человек смотрит не на
// «сколько миллисекунд», а на «похоже ли это на трекер».
//
// Поэтому здесь ровно та же раскладка, что и у настоящего экрана —
// шапка, календарь и встречи слева, три столбца доски в середине, мысли
// справа, — но пустая. Это НЕ второй интерфейс: ни одной кнопки, ни
// одного обработчика, только серые прямоугольники. Отрисовывается он на
// сервере вместе со страницей, то есть попадает в первый же HTML и виден
// до того, как выполнится хоть строчка JavaScript.
//
// Пульсация — одна на все блоки и отключается у тех, кто просил систему
// не анимировать (см. `prefers-reduced-motion` в tracker.css).

function Line({ w, h = 14 }: { w: string; h?: number }) {
  return <div className="skel-line" style={{ width: w, height: h }} />;
}

function Card() {
  return (
    <div className="skel-card">
      <Line w="80%" />
      <Line w="45%" h={11} />
    </div>
  );
}

export default function BootSkeleton() {
  return (
    <div className="skel" aria-hidden>
      <div className="skel-head">
        <div className="skel-logo" />
        <div className="skel-head-text">
          <Line w="120px" h={18} />
          <Line w="180px" h={11} />
        </div>
      </div>

      <div className="skel-layout">
        <div className="skel-col">
          <div className="skel-panel skel-cal">
            <Line w="60%" />
            <div className="skel-grid">
              {Array.from({ length: 28 }).map((_, i) => (
                <div className="skel-day" key={i} />
              ))}
            </div>
          </div>
          <div className="skel-panel">
            <Line w="40%" />
            <Card />
            <Card />
          </div>
        </div>

        <div className="skel-col skel-col-wide">
          <div className="skel-toolbar">
            <div className="skel-pill" style={{ width: 128 }} />
            <div className="skel-pill" style={{ width: 220 }} />
            <div className="skel-pill" style={{ width: 96 }} />
          </div>
          <div className="skel-board">
            {[0, 1, 2].map((col) => (
              <div className="skel-column" key={col}>
                <Line w="50%" h={11} />
                <Card />
                {col === 0 && <Card />}
              </div>
            ))}
          </div>
        </div>

        <div className="skel-col">
          <div className="skel-panel">
            <Line w="55%" />
            <Card />
            <Card />
            <Card />
          </div>
        </div>
      </div>
    </div>
  );
}
