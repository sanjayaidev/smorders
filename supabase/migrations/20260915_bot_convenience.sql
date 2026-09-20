-- Convenience features for the WhatsApp / Instagram / Messenger order bots.
--
--  1. orders.customer_ref: which chat customer placed the order (phone number
--     or Instagram/Messenger sender id). This powers the "status" command and
--     the automatic "your order is being prepared / delivered / cancelled"
--     messages. Website orders leave it null.
--  2. The reserved-keyword trigger now also covers the built-in commands the
--     bots understand in English, Russian, Kazakh and Turkish (menu, status,
--     cart, cancel, help, back, ...). Keep in sync with
--     src/lib/botIntents.js - test/migrations.test.js checks this.
--  3. The seeded "price" keyword reply pointed customers at the "Menu &
--     prices" button, which in turn pointed back at that keyword. It now tells
--     them to send "menu". Only untouched seed text is replaced.
--
-- Safe to run more than once.

alter table public.orders add column if not exists customer_ref text;
create index if not exists orders_channel_customer_ref_idx
  on public.orders (channel, customer_ref, created_at desc)
  where customer_ref is not null;

create or replace function public.reject_order_system_keyword()
returns trigger
language plpgsql
as $$
declare
  keyword text;
  reserved text[] := array[
    'add / change', 'back', 'basket', 'baştan', 'cancel', 'cancel order', 'cart',
    'check order', 'check status', 'clear', 'clear cart', 'commands', 'confirm',
    'confirm_order', 'durum', 'empty cart', 'fiyat', 'fiyat listesi', 'fiyatlar', 'geri',
    'go back', 'help', 'how does this work', 'how to order', 'i want to order',
    'i would like to order', 'iptal', 'iptal et', 'komutlar', 'location', 'menu',
    'menu and prices', 'menu prices', 'menü', 'menüyü göster', 'modify_order', 'my cart',
    'my order', 'my orders', 'nasıl sipariş', 'new order', 'order', 'order status',
    'place order', 'price', 'price list', 'prices', 'reset', 'restart', 'sepet',
    'sepeti boşalt', 'sepeti temizle', 'sepetim', 'show cart', 'show me the menu', 'show menu',
    'siparis', 'siparis ver', 'sipariş', 'sipariş durumu', 'sipariş ver', 'siparişim',
    'siparişim nerede', 'start order', 'start over', 'status', 'stop', 'sıfırla', 'the menu',
    'vazgeç', 'view cart', 'where is my order', 'yardım', 'yeni sipariş', 'yeniden başla',
    'артқа', 'бас тарту', 'баға', 'бағалар', 'бағасы', 'болдырмау', 'где мой заказ',
    'жаңа тапсырыс', 'заказ', 'заказать', 'заново', 'как заказать', 'команды', 'корзина',
    'күй', 'күйі', 'көмек', 'көмектес', 'меню', 'менің себетім', 'менің тапсырысым',
    'мой заказ', 'моя корзина', 'мәзір', 'мәзірді көрсет', 'назад', 'начать заново',
    'новый заказ', 'отмена', 'отменить', 'отменить заказ', 'очистить', 'очистить корзину',
    'покажи корзину', 'покажи меню', 'покажите меню', 'помоги', 'помощь', 'прайс',
    'прайс лист', 'проверить заказ', 'сброс', 'сбросить', 'сделать заказ', 'себет',
    'себетті тазала', 'себетті тазалау', 'статус', 'статус заказа', 'тапсырыс',
    'тапсырыс беру', 'тапсырыс күйі', 'тапсырысым қайда', 'тоқтату', 'хочу заказать', 'цена',
    'цены', 'қайта бастау', 'қалай тапсырыс беремін'
  ];
begin
  foreach keyword in array coalesce(new.keywords, '{}') loop
    if lower(trim(keyword)) = any(reserved) then
      raise exception 'Keyword "%" is reserved by the order system.', keyword
        using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end;
$$;

do $$
declare
  seeded constant text := 'You can see our full menu and prices any time%';
  replacement constant text := 'Send "menu" to see our full menu and prices 💰';
begin
  if to_regclass('public.wa_keywords') is not null then
    update public.wa_keywords set response = replacement where keyword = 'price' and response like seeded;
  end if;
  if to_regclass('public.ig_keywords') is not null then
    update public.ig_keywords set response = replacement where keyword = 'price' and response like seeded;
  end if;
  if to_regclass('public.fb_keywords') is not null then
    update public.fb_keywords set response = replacement where keyword = 'price' and response like seeded;
  end if;
end;
$$;
