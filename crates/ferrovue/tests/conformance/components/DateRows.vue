<script setup lang="ts">
import { computed } from "vue";
import DateDays from "./DateDays.vue";
import DateStamp from "./DateStamp.vue";

interface Row {
  title: string;
  at: Date;
  edited?: Date;
  deleted: Date | null;
  marks: Date[];
  seen: (Date | null)[];
  byName: Record<string, Date>;
}

const props = defineProps<{ rows: Row[]; days: Date[]; maybe?: Date[]; stamps: Record<string, Date>; lead: Row | null }>();
const edits = computed(() => props.rows.filter((r) => r.edited !== undefined).length);
const first = computed(() => props.days.at(0));
</script>

<template>
  <section>
    <article v-for="(row, i) in rows" :key="i">
      <h3>{{ row.title }}</h3>
      <time v-if="row.at.getTime() === row.at.getTime()" :datetime="row.at.toISOString()">
        {{ row.at.getUTCFullYear() }}-{{ row.at.getUTCMonth() + 1 }}-{{ row.at.getUTCDate() }} {{ row.at.getUTCHours() }}:{{ row.at.getUTCMinutes() }}:{{ row.at.getUTCSeconds() }}.{{ row.at.getUTCMilliseconds() }} day {{ row.at.getUTCDay() }}
      </time>
      <p v-else>invalid {{ row.at.getTime() }} {{ row.at.toUTCString() }}</p>
      <p v-if="row.edited">edited {{ row.edited.valueOf() }}{{ row.edited > row.at ? " after" : "" }}{{ row.edited <= row.at ? " not after" : "" }}</p>
      <p v-if="row.deleted !== null">deleted {{ row.deleted.toUTCString() }}</p>
      <ul>
        <li v-for="(mark, j) in row.marks" :key="j">{{ j }}: {{ mark.getTime() }} {{ mark >= row.at ? "on or after" : "before or invalid" }}</li>
      </ul>
      <ol>
        <li v-for="(seen, j) in row.seen" :key="j">{{ seen === null ? "unseen" : String(seen.getUTCFullYear()) }}</li>
      </ol>
      <dl>
        <template v-for="(stamp, name) in row.byName" :key="name">
          <dt>{{ name }}</dt>
          <dd>{{ stamp.getTime() }}</dd>
        </template>
      </dl>
      <DateDays :days="row.marks" :by="row.byName" :seen="row.seen" />
      <DateStamp :at="row.at" :edited="row.edited" :deleted="row.deleted" :shown="row.marks.at(-1) ?? row.at" />
    </article>
    <p>{{ rows.length }} rows, {{ edits }} edited, {{ days.length }} days{{ maybe ? `, ${maybe.length} maybe` : "" }}</p>
    <i v-for="(day, k) in days" :key="k">{{ day.getUTCDate() }}/{{ day.getUTCMonth() + 1 }}</i>
    <b v-if="first">{{ first.getTime() }}</b>
    <template v-if="maybe">
      <s v-for="(day, k) in maybe" :key="k">{{ day.getTime() }}</s>
    </template>
    <u v-for="(stamp, name, k) in stamps" :key="name">{{ k }} {{ name }}={{ stamp.getTime() }}</u>
    <em v-for="(stamp, k) in Object.values(stamps)" :key="k">{{ stamp.getUTCHours() }}</em>
    <DateDays :days="days.filter((d) => d.getTime() === d.getTime())" :maybe="maybe" :by="stamps" :seen="[]" />
    <p v-if="lead">lead {{ lead.title }} {{ lead.at.getTime() }} {{ lead.marks.length }}</p>
  </section>
</template>
