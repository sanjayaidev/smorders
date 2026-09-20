-- Real Russian names and descriptions for the menu.
--
-- Every product's "ru" name and description was a copy of the English text, so
-- customers using the Russian site or bots saw English. Only rows whose "ru"
-- value is missing or identical to the English one are touched, so any
-- translation you have already written by hand is kept.
--
-- Also: "Nutella & Chocolate Simit" has the description "Coming soon." in every
-- language but was still active and orderable, so it is flagged coming_soon.
-- Undo with:  update public.products set coming_soon = false where slug = 'nutella-simit';
--
-- Assumes products.name / products.description / categories.name are jsonb.
-- Safe to run more than once.

update public.products p
set
  name = case
    when coalesce(p.name->>'ru', '') in ('', coalesce(p.name->>'en', ''))
      then p.name || jsonb_build_object('ru', v.name_ru)
    else p.name
  end,
  description = case
    when coalesce(p.description->>'ru', '') in ('', coalesce(p.description->>'en', ''))
      then p.description || jsonb_build_object('ru', v.description_ru)
    else p.description
  end
from (values
    ('klasik-simit', 'Классический симит', 'Традиционное кольцо из хлеба, обсыпанное кунжутом.'),
    ('sucuklu-kasarli-simit', 'Симит с суджуком и сыром', 'Симит с турецкой колбасой суджук и расплавленным сыром.'),
    ('yumurtali-kasarli-simit', 'Симит с яйцом и сыром', 'Симит с яйцом и расплавленным сыром.'),
    ('kasarli-domatesli-simit', 'Симит с сыром и помидором', 'Симит с расплавленным сыром и свежим помидором.'),
    ('nutella-simit', 'Симит с Nutella и шоколадом', 'Скоро.'),
    ('sade-acma', 'Ачма классическая', 'Мягкая свежая дрожжевая булочка.'),
    ('cikolatali-acma', 'Ачма с шоколадом', 'Мягкая дрожжевая булочка с шоколадной начинкой.'),
    ('lor-peynirli-pogaca', 'Погача с творогом', 'Мягкая солёная булочка с творогом.'),
    ('peynirli-pogaca', 'Погача с сыром', 'Мягкая солёная булочка с сыром.'),
    ('sosisli-pogaca', 'Погача с сосиской', 'Мягкая солёная булочка с сосиской.'),
    ('lor-peynirli-gozleme', 'Гёзлеме с творогом', 'Тонкая лепёшка ручной раскатки с творожным сыром.'),
    ('ispanakli-lor-peynirli-gozleme', 'Гёзлеме со шпинатом и творогом', 'Тонкая лепёшка со шпинатом и творогом.'),
    ('patatesli-gozleme', 'Гёзлеме с картофелем', 'Тонкая лепёшка с пряным картофелем.'),
    ('lor-peynirli-gul-boregi', 'Розовый бёрек с творогом', 'Бёрек из теста фило в форме розы с творогом.'),
    ('ispanakli-gul-boregi', 'Розовый бёрек со шпинатом', 'Бёрек из теста фило в форме розы со шпинатом.'),
    ('dana-etli-gul-boregi', 'Розовый бёрек с говядиной', 'Бёрек из теста фило в форме розы с приправленной говядиной.'),
    ('karisik-assorti-borek', 'Ассорти из бёреков', 'Ассорти из розовых бёреков, начинки на ваш выбор, 1 кг.'),
    ('sucuk', 'Суджук (турецкая колбаса)', 'Традиционная пряная турецкая говяжья колбаса.'),
    ('pastirma', 'Пастырма (вяленая говядина со специями)', 'Вяленая на воздухе говядина в пряной обмазке.'),
    ('acili-cig-kofte', 'Острый чиг кёфте', 'Острые кёфте на основе булгура, без сырого мяса.'),
    ('kavurma', 'Кавурма (томлёное мясо)', 'Медленно обжаренное мясо с насыщенными специями.'),
    ('fistikli-baklava', 'Баклава с фисташками', 'Слоёное тесто фило с измельчёнными фисташками, пропитанное сиропом.'),
    ('sutlu-baklava', 'Молочная баклава', 'Нежная баклава на молочной основе.'),
    ('cevizli-baklava', 'Баклава с грецким орехом', 'Слоёное тесто фило с измельчёнными грецкими орехами, пропитанное сиропом.'),
    ('sutlac', 'Сютлач (рисовый пудинг)', 'Традиционный рисовый пудинг, запечённый в печи.'),
    ('profiterol', 'Профитроли', 'Заварные пирожные с кремом и шоколадной глазурью.'),
    ('trileçe', 'Трилече', 'Нежный бисквит, пропитанный тремя видами молока, 12 порций.'),
    ('kazandibi', 'Казандиби (карамелизированный молочный пудинг)', 'Традиционный карамелизированный молочный пудинг, 12 порций.')
) as v(slug, name_ru, description_ru)
where p.slug = v.slug;

update public.products set coming_soon = true where slug = 'nutella-simit';

-- Category names (matched by id, taken from your products export).
update public.categories c
set name = c.name || jsonb_build_object('ru', v.name_ru)
from (values
    ('5022f421-b4d2-471b-90aa-f380c1daba3d'::uuid, 'Симит'),
    ('2fd846a8-3b1d-48b8-a6df-6646af88b15c'::uuid, 'Выпечка'),
    ('ba727e11-3813-447d-a45f-7684728df1c5'::uuid, 'Гёзлеме'),
    ('b404ae2f-5048-40fb-a5bc-f8e605445281'::uuid, 'Бёрек'),
    ('c704b7b9-dd91-4755-8903-de057262cd1c'::uuid, 'Мясные деликатесы'),
    ('d8848f2d-f4b1-44e7-8639-744391d2ceaf'::uuid, 'Десерты')
) as v(id, name_ru)
where c.id = v.id
  and coalesce(c.name->>'ru', '') in ('', coalesce(c.name->>'en', ''));
