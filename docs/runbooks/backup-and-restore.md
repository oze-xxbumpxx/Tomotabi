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

`REASON`には、取るきっかけを`weekly`・`before-trip`・`after-trip`・`before-change`・`before-launch`（最初の公開の前）・`incident`（障害のとき）から1つ入れる。ファイル名に入り、5章で残すものを見分けるのに使う。

```bash
read -rs "MIGRATION_DATABASE_URL?本番のmigratorの直接の接続: "; echo
REASON=weekly
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

`.before.txt`は暗号化しない。中身は二人の利用者のID（ランダムな文字列）と、表ごとの件数・支払いと精算の合計額だけで、名前・メール・支払いの中身は入っていない。

## 3. クラウドにも置く

```bash
cp ~/TomotabiBackups/$NAME.dump.age ~/TomotabiBackups/$NAME.before.txt "<0章で決めたクラウドのフォルダ>/"
```

## 4. 手元へ戻して照合する

`weekly`・`before-trip`・`after-trip`のときは、月に1回だけでよい。`before-change`と`before-launch`のときは毎回行い、照合が合ってから先へ進む。

使い捨てのPostgreSQL 16を立てる。ここで使うパスワードは、このコンテナの中だけのもの。データの置き場をメモリ（`--tmpfs`）にするので、戻した実データはディスクに書かれず、コンテナを消せば残らない。最初の行は、前回の照合のコンテナが残っていたときに消すためのもの。

```bash
docker rm -fv tomotabi-restore-check 2>/dev/null
docker run -d --name tomotabi-restore-check --tmpfs /var/lib/postgresql/data -e POSTGRES_PASSWORD=restore -p 127.0.0.1:55432:5432 postgres:16-alpine
until docker exec tomotabi-restore-check pg_isready -h 127.0.0.1 -U postgres >/dev/null; do sleep 1; done
R_ADMIN="postgresql://postgres:restore@127.0.0.1:55432"
psql "$R_ADMIN/postgres" -v ON_ERROR_STOP=1 -v migrator_password=restore -v app_runtime_password=restore -f apps/api/db/admin/create-roles.sql
psql "$R_ADMIN/postgres" -v ON_ERROR_STOP=1 -c 'CREATE DATABASE tomotabi_restored'
psql "$R_ADMIN/tomotabi_restored" -v ON_ERROR_STOP=1 -f apps/api/db/admin/grant-database.sql
```

ロールはクラスタのものでdumpに入らないので、ここで作り直す（OPS-13のロールの作り直し）。

dumpを戻し、後始末をしてから照合する。

```bash
setopt pipefail
age -d ~/TomotabiBackups/$NAME.dump.age \
  | docker exec -i -e PGPASSWORD=restore tomotabi-restore-check pg_restore -h 127.0.0.1 -U migrator -d tomotabi_restored --no-owner --exit-on-error \
  && echo "復元できた"
R_URL="postgresql://migrator:restore@127.0.0.1:55432/tomotabi_restored"
PGOPTIONS='-c tomotabi.restored_copy=tomotabi_restored' psql "$R_URL" -v ON_ERROR_STOP=1 -f apps/api/db/admin/neutralize-restored.sql
psql "$R_URL" -v ON_ERROR_STOP=1 -At -F ' ' -f apps/api/db/admin/verify-restore.sql > /tmp/tomotabi-restored.txt
diff ~/TomotabiBackups/$NAME.before.txt /tmp/tomotabi-restored.txt && echo "照合が合った"
grep '^settlement.active_claims.mismatch_with_history ' /tmp/tomotabi-restored.txt
```

合格の条件は4つ。

- `pg_restore`の行のあとに「復元できた」と出る。
- `diff`が何も出さず「照合が合った」と出る。
- 最後の行が`settlement.active_claims.mismatch_with_history 0`。
- 後始末の表で、`sessions`・`verifications`・`enabled_push_subscriptions`がすべて0。

合わなかったときも、途中でやめたときも、先に下の片付けをする。そのうえで、その先（migration・公開）へ進まず、Claude Codeに「どの行が違ったか」だけを伝える（数字そのものは貼らなくてよい）。

最後に、コンテナと照合の結果を消す。

```bash
docker rm -fv tomotabi-restore-check
rm -f /tmp/tomotabi-restored.txt
```

## 5. 古いバックアップを消す

手元とクラウドの両方で、直近4回と、最後の`before-change`の1回を残し、それより古い`.dump.age`・`.before.txt`・`.after.txt`を消す。

## 6. 本当の障害で本番に戻す

DBの記録が壊れた・消えたときだけ行う。初回の公開の前には試さない。ここでは本番の元のDBと戻した先が同じNeonのプロジェクトにあり、接続文字列の違いはDB名かホスト名だけになる。取り違えないよう、戻した先の接続は別の変数（`RESTORED_URL`）に入れ、本番の変数は先に消す。

1. [本番の手順書](production.md)の14章で、完全停止する。
2. いまの壊れた状態も、1〜2章のやり方でdumpに残す（`REASON=incident`）。
3. 元のDBに、実行用のロールがもうつながらないようにする。14章の再開はロールのログインを全体で戻すので、これをしないと、古いデプロイが元のDBにまた書ける。接続の権限は既定で全員（PUBLIC）にも付いているので、PUBLICからも外す（migratorには個別に付けてあるので、管理の作業は続けられる）。

   ```bash
   read -rs "ADMIN_URL?本番の管理者の接続: "; echo
   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c 'REVOKE CONNECT ON DATABASE neondb FROM PUBLIC, app_runtime'
   ```

4. 戻す先を、元のDBとは別に作る。元のDBには上書きしない。
   - Neonの短い復元（最大6時間前まで）で戻せる時点なら、Neonの管理画面でその時点の新しいブランチを作る。元のブランチのcomputeは止めたままにし、再開しない。新しいブランチのmigratorの直接の接続を`RESTORED_URL`に入れる。DB名は本番と同じ`neondb`になる。

     ```bash
     unset MIGRATION_DATABASE_URL ADMIN_URL
     read -rs "RESTORED_URL?新しいブランチのmigratorの直接の接続: "; echo
     RESTORED_DB=neondb
     ```

   - それより前なら、本番の管理者の接続で空のDB`tomotabi_restored`を作り、そこへバックアップを戻す（ロールはプロジェクトに既にある）。

     ```bash
     RESTORED_DB=tomotabi_restored
     psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c 'CREATE DATABASE tomotabi_restored'
     read -rs "RESTORED_ADMIN_URL?本番の管理者の接続（DB名をtomotabi_restoredにしたもの）: "; echo
     psql "$RESTORED_ADMIN_URL" -v ON_ERROR_STOP=1 -f apps/api/db/admin/grant-database.sql
     unset MIGRATION_DATABASE_URL ADMIN_URL
     read -rs "RESTORED_URL?migratorの直接の接続（DB名をtomotabi_restoredにしたもの）: "; echo
     setopt pipefail
     age -d ~/TomotabiBackups/<戻すファイル>.dump.age \
       | DB_URL="$RESTORED_URL" docker run --rm -i -e DB_URL postgres:16-alpine sh -c 'exec pg_restore --dbname="$DB_URL" --no-owner --exit-on-error' \
       && echo "復元できた"
     ```

5. 戻した先で照合の数字を取る。

   ```bash
   psql "$RESTORED_URL" -v ON_ERROR_STOP=1 -At -F ' ' -f apps/api/db/admin/verify-restore.sql > /tmp/tomotabi-restored.txt
   ```

   比べ方は、戻す道で違う。
   - dumpから戻したときは、そのdumpの`.before.txt`と全部の行が同じになる。

     ```bash
     diff ~/TomotabiBackups/<戻すファイル>.before.txt /tmp/tomotabi-restored.txt && echo "照合が合った"
     ```

   - Neonのブランチに戻したときは、戻した時点が最後のdumpより後なので、件数と金額は`.before.txt`と同じにならない。次の3つを見る。`settlement.active_claims.mismatch_with_history`が0。`migrations.count`と`migrations.last_hash`が最後のdumpの`.before.txt`以上で、そのあとmigrationを流していなければ同じ。履歴の表（`record.payments`・`record.payment_cancellations`・`settlement.settlements`・`settlement.items`・`settlement.cancellations`）の件数が、最後のdumpの`.before.txt`より少なくない（履歴は消さない作りなので、減っていれば戻した時点が古すぎる）。

     ```bash
     grep -E '^(settlement.active_claims.mismatch_with_history|migrations|record.payments.count|record.payment_cancellations.count|settlement.settlements.count|settlement.items.count|settlement.cancellations.count) ' /tmp/tomotabi-restored.txt ~/TomotabiBackups/<最後のdump>.before.txt
     ```

6. 戻した先で後始末をする（全部のセッションを消し、購読を止める。二人はログインし直し、通知を許可し直す）。設定の値には、4で決めたつないだ先のDB名（`RESTORED_DB`）を入れる。DB名が合わないと止まる。ブランチのときはDB名が本番と同じになるので、先にホスト名を表示し、Neonの管理画面にある新しいブランチのホスト名と同じかを見てから流す。

   ```bash
   RESTORED_URL="$RESTORED_URL" python3 -c 'import os,urllib.parse as u; p=u.urlsplit(os.environ["RESTORED_URL"]); print(p.hostname, p.path)'
   PGOPTIONS="-c tomotabi.restored_copy=${RESTORED_DB:?}" psql "$RESTORED_URL" -v ON_ERROR_STOP=1 -f apps/api/db/admin/neutralize-restored.sql
   ```

7. Vercelの`tomotabi-api`の`DATABASE_URL`を、戻した先のapp_runtimeのpooledの接続に替え、本番の手順書の10章の3〜5で同じcommitを出し直す。
8. 本番の手順書の14章で再開する。元のDBは3で、元のブランチは4で止めてあるので、再開しても戻した先にしかつながらない。二人に、戻した時点より後の支払い・受け渡しを確かめてもらい、必要なものだけ記録し直してもらう。自動で記録し直さない。
9. 作業が済んだら`unset RESTORED_URL RESTORED_ADMIN_URL RESTORED_DB`とし、`/tmp/tomotabi-restored.txt`を消す。
