# 手順書: 本番のDBのバックアップと復元

- 対象: 本番のNeon（`tomotabi-production`）
- 設計: [docs/designs/production-launch.md](../designs/production-launch.md)「バックアップと復元」
- 作業する人: ユーザー（管理者の端末）。dumpは二人の実データなので、Claude Codeに中身を見せない

dumpは`pg_dump`の版をDBと同じ16にそろえるため、Dockerの`postgres:16-alpine`の中の`pg_dump`・`pg_restore`を使う。暗号化は`age`のパスフレーズで行い、平文のdumpはディスクに書かない。

## 0. 準備（最初の1回）

1. Docker Desktopを入れて起動しておく。
2. `age`を入れる。

   ```bash
   brew install age
   ```

3. 置き場所を2つ決める。手元のPCは`~/TomotabiBackups`、クラウドは普段使っているストレージの同期フォルダ（iCloud Driveなら`~/Library/Mobile Documents/com~apple~CloudDocs/TomotabiBackups`）。どちらもリポジトリの外にする。

   ```bash
   mkdir -p ~/TomotabiBackups
   ```

4. パスフレーズを作り、パスワード管理ソフトに「Tomotabi バックアップ」の名前で置く。PCとは別の場所（パスワード管理ソフトの同期先）にも残ることを確かめてから、最初のdumpを取る。パスフレーズを無くすと、どのバックアップも戻せない。

以下のコマンドはリポジトリのルートで、zshで動かす。

## 1. 照合の基準の数字を取る（dumpの直前）

```bash
read -rs "MIGRATION_DATABASE_URL?本番のmigratorの直接の接続: "; echo
REASON=weekly   # weekly / before-trip / after-trip / before-change / before-launch
NAME="tomotabi-production-$(date +%Y%m%d-%H%M)-$REASON"
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -At -F ' ' -f apps/api/db/admin/verify-restore.sql > ~/TomotabiBackups/$NAME.before.txt
```

## 2. dumpを取って暗号化する

```bash
setopt pipefail
DB_URL="$MIGRATION_DATABASE_URL" docker run --rm -e DB_URL postgres:16-alpine sh -c 'exec pg_dump --dbname="$DB_URL" -Fc' \
  | age -p -o ~/TomotabiBackups/$NAME.dump.age \
  || { echo "dumpに失敗した"; rm -f ~/TomotabiBackups/"${NAME:?}".dump.age; }
```

`age`がパスフレーズを2回聞くので、0章のパスフレーズを入れる（空のまま押すと別のパスフレーズが作られるので、必ず入れる）。接続文字列は環境変数で渡すので、コマンドの引数には出ない。

続けて、dumpの直後の数字を取り、直前と比べる。

```bash
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -At -F ' ' -f apps/api/db/admin/verify-restore.sql > ~/TomotabiBackups/$NAME.after.txt
diff ~/TomotabiBackups/$NAME.before.txt ~/TomotabiBackups/$NAME.after.txt && echo "基準の数字はそろっている"
```

違いが出たら、dumpのあいだに二人が書き込んだ。1章からやり直す（できたファイルは消してよい）。

## 3. クラウドにも置く

```bash
cp ~/TomotabiBackups/$NAME.dump.age ~/TomotabiBackups/$NAME.before.txt "<0章で決めたクラウドのフォルダ>/"
```

## 4. 手元へ戻して照合する

`weekly`・`before-trip`・`after-trip`のときは、月に1回だけでよい。`before-change`と`before-launch`のときは毎回行い、照合が合ってから先へ進む。

使い捨てのPostgreSQL 16を立てる。ここで使うパスワードは、このコンテナの中だけのもの。

```bash
docker run -d --name tomotabi-restore-check -e POSTGRES_PASSWORD=restore -p 127.0.0.1:55432:5432 postgres:16-alpine
until docker exec tomotabi-restore-check pg_isready -h 127.0.0.1 -U postgres >/dev/null; do sleep 1; done
R_ADMIN="postgresql://postgres:restore@127.0.0.1:55432"
psql "$R_ADMIN/postgres" -v ON_ERROR_STOP=1 -v migrator_password=restore -v app_runtime_password=restore -f apps/api/db/admin/create-roles.sql
psql "$R_ADMIN/postgres" -v ON_ERROR_STOP=1 -c 'CREATE DATABASE tomotabi'
psql "$R_ADMIN/tomotabi" -v ON_ERROR_STOP=1 -f apps/api/db/admin/grant-database.sql
```

ロールはクラスタのものでdumpに入らないので、ここで作り直す（OPS-13のロールの作り直し）。

dumpを戻し、後始末をしてから照合する。

```bash
age -d ~/TomotabiBackups/$NAME.dump.age \
  | docker exec -i -e PGPASSWORD=restore tomotabi-restore-check pg_restore -h 127.0.0.1 -U migrator -d tomotabi --no-owner --exit-on-error
R_URL="postgresql://migrator:restore@127.0.0.1:55432/tomotabi"
PGOPTIONS='-c tomotabi.restored_copy=yes' psql "$R_URL" -v ON_ERROR_STOP=1 -f apps/api/db/admin/neutralize-restored.sql
psql "$R_URL" -v ON_ERROR_STOP=1 -At -F ' ' -f apps/api/db/admin/verify-restore.sql > /tmp/tomotabi-restored.txt
diff ~/TomotabiBackups/$NAME.before.txt /tmp/tomotabi-restored.txt && echo "照合が合った"
grep '^settlement.active_claims.mismatch_with_history ' /tmp/tomotabi-restored.txt
```

合格の条件は3つ。

- `diff`が何も出さず「照合が合った」と出る。
- 最後の行が`settlement.active_claims.mismatch_with_history 0`。
- 後始末の表で、`sessions`・`verifications`・`enabled_push_subscriptions`がすべて0。

照合が合わなければ、その先（migration・公開）へ進まず、Claude Codeに「どの行が違ったか」だけを伝える（数字そのものは貼らなくてよい）。

最後に、コンテナと照合の結果を消す。実データを手元のDBに残さない。

```bash
docker rm -f tomotabi-restore-check
rm -f /tmp/tomotabi-restored.txt
```

## 5. 古いバックアップを消す

手元とクラウドの両方で、直近4回と、最後の`before-change`の1回を残し、それより古い`.dump.age`・`.before.txt`・`.after.txt`を消す。

## 6. 本当の障害で本番に戻す

DBの記録が壊れた・消えたときだけ行う。初回の公開の前には試さない。

1. [本番の手順書](production.md)の14章で、完全停止する。
2. いまの壊れた状態も、2章のやり方でdumpに残す（きっかけ`incident`）。
3. 戻す先を、元のDBとは別に作る。元のDBには上書きしない。
   - Neonの短い復元（最大6時間前まで）で戻せる時点なら、Neonの管理画面でその時点の新しいブランチを作る。
   - それより前なら、本番の管理者の接続で空のDBを作り（`CREATE DATABASE tomotabi_restored`）、そのDBで`grant-database.sql`を流してから、4章の`pg_restore`の行の宛先をそのDBのmigratorの直接の接続に替えて戻す（ロールはプロジェクトに既にある）。
4. 戻した先で`verify-restore.sql`を流し、バックアップを取ったときの`.before.txt`と比べる。
5. 戻した先で`neutralize-restored.sql`を流す（全部のセッションを消し、購読を止める。二人はログインし直し、通知を許可し直す）。
6. Vercelの`tomotabi-api`の`DATABASE_URL`を、戻した先のapp_runtimeのpooledの接続に替え、本番の手順書の10章の3〜5で同じcommitを出し直す。
7. 本番の手順書の14章で再開する。二人に、戻した時点より後の支払い・受け渡しを確かめてもらい、必要なものだけ記録し直してもらう。自動で記録し直さない。
