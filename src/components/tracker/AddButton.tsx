"use client";

// «+» слева от микрофона — у каждого поля, из которого что-то ЗАВОДИТСЯ:
// мысль, пункт повестки, новая задача, новая встреча, быстрый ввод.
// 21.10.2026, его слова: «слева от микрофона такую же фирменную кнопку „+“…
// везде слева надо воткнуть». Делает ровно то же, что Enter в этом поле, —
// третий, явный способ, а не новое действие; на телефоне Enter в
// однострочном поле не всегда под рукой, и кнопка там нужнее всего.
//
// Полей ПРАВКИ (описание открытой задачи, текст своей мысли, итог встречи,
// строка чата) здесь нет нарочно: у них рядом уже стоит своё слово —
// «Готово», «Успех / Провал», «Отправить», — и «+» читался бы вторым,
// непонятным способом сделать то же самое.
import Icon from "./Icon";

export default function AddButton({
  onClick,
  disabled,
  title,
  id,
  type = "button",
  className = "",
}: {
  onClick?: () => void;
  disabled?: boolean;
  title: string;
  id?: string;
  // В форме быстрого ввода кнопка — её submit, чтобы путь был один с Enter.
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      id={id}
      className={"field-mic-btn field-add-btn" + (className ? " " + className : "")}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name="plus" size={16} />
    </button>
  );
}
