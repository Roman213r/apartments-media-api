# Apartments API

TypeScript-бекенд: квартири (CRUD і пагінація) та завантаження фото в S3 у форматі WebP.

Бакет `optima-apartments-john32sfsf` лишається приватним. Ключ IAM не має права робити об'єкти публічними, тому API саме віддає картинки за стабільним URL.

## Запуск

Потрібен Node.js 22+.

```bash
npm install
npm run build
npm start
```

`npm run dev` перезапускає сервер під час правок. На цій машині Node не бачить системні сертифікати, тому скрипти вже запускаються з `--use-system-ca`.

Сервер: `http://localhost:3000`

Секрети лежать у `.env` (файл у `.gitignore`). Зразок без секретів — `.env.example`.

## Картинки

`POST /api/images` — `multipart/form-data`, поле `file` (можна кілька). JPEG, PNG, GIF, WebP, AVIF, HEIC. Файл стискається до WebP (макс. 1920 px, quality 80) і кладеться в S3.

```bash
curl -F "file=@photo.jpg" http://localhost:3000/api/images
```

Відповідь містить `key` і `url`. Картинку можна відкрити за `url`.

Видалення:

```bash
curl -X DELETE http://localhost:3000/api/images ^
  -H "Content-Type: application/json" ^
  -d "{\"keys\":[\"uploads/<uuid>.webp\"]}"
```

## Квартири

`POST /api/apartments`

```json
{
  "title": "2-кімнатна на Сихів",
  "description": "Після ремонту",
  "price": 25000,
  "currency": "UAH",
  "city": "Львів",
  "address": "вул. Сихівська 1",
  "rooms": 2,
  "areaM2": 54.5,
  "floor": 4,
  "imageKeys": ["uploads/<uuid>.webp"]
}
```

Обов'язкові поля: `title`, `price`. Решта має значення за замовчуванням.

- `GET /api/apartments?page=1&limit=20&q=сихів&city=Львів`
- `GET /api/apartments/:id`
- `PATCH /api/apartments/:id` — будь-які поля з тіла створення
- `DELETE /api/apartments/:id` — прибирає квартиру і її фото з S3, якщо їх більше ніхто не використовує

Список:

```json
{
  "data": [],
  "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

`price` — ціле число в одиницях валюти (для UAH це гривні).
