use std::borrow::Cow;

use ferrovue::{Head, Html, I18n, Page, Part, Route, Slot, Teleports};

use crate::generated::{
    blank, books_id, cart_badge, counter, data_list, greeting, head_note, i18n, index, modal,
    picker, provides, rated, render_json, route_table, shell, stores, theme_scope, themed_button,
    translated, twins, types,
};

const _: fn(&mut String, &greeting::Props<'_>) = greeting::render;
const _: fn(&mut String, &counter::Props) = counter::render;
const _: fn(&mut String, &blank::Props) = blank::render;
const _: fn(&mut String, &data_list::Props<'_>, data_list::Slots<'_>) = data_list::render;
const _: fn(&mut String, &cart_badge::Props, &stores::Stores<'_>) = cart_badge::render;
const _: fn(&mut String, &translated::Props<'_>, &I18n) = translated::render;
const _: fn(&mut String, &modal::Props<'_>, &Teleports) = modal::render;
const _: fn(&mut String, &themed_button::Props<'_>, provides::Provides<'_>) = themed_button::render;
const _: fn(&mut String, &theme_scope::Props<'_>, theme_scope::Slots<'_>, provides::Provides<'_>) =
    theme_scope::render;
const _: fn(&mut String, &head_note::Props<'_>, &Head) = head_note::render;
const _: fn(&mut String, &rated::Props) = rated::render;
const _: fn(&mut String, &index::Props<'_>) = index::render;
const _: fn(&mut String, &books_id::Props<'_>) = books_id::render;
#[allow(clippy::type_complexity)]
const _: fn(
    &mut String,
    &shell::Props<'_>,
    shell::Slots<'_>,
    &Route<'_>,
    &stores::Stores<'_>,
    &I18n,
    &Teleports,
    provides::Provides<'_>,
    &Head,
) = shell::render;
const _: twins::StarRatingRender = crate::twins::star_rating;

#[allow(dead_code)]
struct Owned {
    counter: counter::Props,
    blank: blank::Props,
    picker: picker::Props,
    rated: rated::Props,
    cart_badge: cart_badge::Props,
    count: data_list::CountSlotProps,
    star: twins::StarRatingProps,
}

fn render(f: impl FnOnce(&mut String)) -> String {
    let mut out = String::new();
    f(&mut out);
    out
}

#[test]
fn names_are_the_components_names() {
    assert_eq!(greeting::NAME, "Greeting");
    assert_eq!(data_list::NAME, "DataList");
    assert_eq!(cart_badge::NAME, "CartBadge");
    assert_eq!(index::NAME, "Index");
    assert_eq!(books_id::NAME, "BooksId");
}

#[test]
fn props_are_built_with_new_and_setters_or_as_literals() {
    let built = greeting::Props::new("Ada")
        .unread(3)
        .show_head(true)
        .r#type("wide")
        .model_value("typed");
    let literal = greeting::Props {
        name: Cow::Borrowed("Ada"),
        unread: Some(3),
        show_head: Some(true),
        r#type: Some(Cow::Borrowed("wide")),
        model_value: Some(Cow::Borrowed("typed")),
    };
    let expected = r#"<p class="wide">Hello, Ada!<b>3</b>typed</p>"#;
    assert_eq!(render(|out| greeting::render(out, &built)), expected);
    assert_eq!(render(|out| greeting::render(out, &literal)), expected);

    let counter = counter::Props::new(3).step(2);
    let literal = counter::Props {
        count: 3,
        step: Some(2),
    };
    assert_eq!(
        render(|out| counter::render(out, &counter)),
        "<output>3/2</output>"
    );
    assert_eq!(
        counter::html(&literal).into_string(),
        "<output>3/2</output>"
    );
    assert_eq!(render(|out| blank::render(out, &blank::Props {})), "<hr>");
    assert_eq!(
        render(|out| blank::render(out, &blank::Props::new())),
        render(|out| blank::render(out, &blank::Props::default()))
    );
}

#[test]
fn html_island_and_their_owned_forms_render_the_same_markup() {
    let props = greeting::Props::new("Ada").unread(2);
    let markup = render(|out| greeting::render(out, &props));
    assert_eq!(greeting::html(&props).into_string(), markup);
    let island = greeting::island(&props).into_string();
    assert!(island.starts_with(r#"<div data-island="Greeting" data-props="{&quot;name&quot;:&quot;Ada&quot;,&quot;unread&quot;:2}">"#));
    assert!(island.ends_with(&format!("{markup}</div>")));
    fn owned(name: String) -> Html<'static, greeting::Props<'static>> {
        greeting::into_html(greeting::Props::new(name))
    }
    fn owned_island(name: String) -> Html<'static, greeting::Props<'static>> {
        greeting::into_island(greeting::Props::new(name))
    }
    assert_eq!(
        owned("Ada".to_owned()).into_string(),
        greeting::html(&greeting::Props::new("Ada")).into_string()
    );
    assert_eq!(
        owned_island("Ada".to_owned()).into_string(),
        greeting::island(&greeting::Props::new("Ada")).into_string()
    );
    let counter: Html<'static, counter::Props> = counter::into_island(counter::Props::new(1));
    assert!(
        counter
            .into_string()
            .starts_with(r#"<div data-island="Counter""#)
    );
}

#[test]
fn local_and_shared_types_and_scoped_slots() {
    let rows = vec![
        data_list::Row::new("a"),
        data_list::Row::new("b").hint("second"),
    ];
    let props = data_list::Props::new(
        "Rows",
        rows,
        types::Owner::new("Ada").email("ada@example.com"),
    );
    let row = |out: &mut String, p: &data_list::RowSlotProps<'_>| -> bool {
        out.push_str(&p.row.label);
        ferrovue::push_int(out, p.index);
        true
    };
    let count = |out: &mut String, p: &data_list::CountSlotProps| -> bool {
        ferrovue::push_int(out, p.n);
        true
    };
    let rest = |out: &mut String| out.push_str("rest");
    let slots = data_list::Slots {
        row: Some(&row as &data_list::RowSlot<'_>),
        count: Some(&count as &data_list::CountSlot<'_>),
        default: Some(Slot::new(&rest)),
    };
    let out = render(|out| data_list::render(out, &props, slots));
    assert!(
        out.contains("<li><!--[-->a0<!--]--></li><li><!--[-->b1<!--]--></li>"),
        "{out}"
    );
    assert!(
        out.contains("<!--[-->2<!--]--><!--[-->rest<!--]-->"),
        "{out}"
    );
    let empty = render(|out| data_list::render(out, &props, data_list::Slots::default()));
    assert!(empty.contains("<li><!--[-->a<!--]--></li>"), "{empty}");
    assert_eq!(data_list::html(&props, slots).into_string(), out);

    assert_eq!(types::CHOICES.len(), 2);
    assert_eq!(types::CHOICES[1].label, "Two");
    assert_eq!(types::Choice::new(3, "Three").id, 3);
    assert!(
        render(|out| picker::render(out, &picker::Props::new(2)))
            .contains(r#"<li class="picked">Two</li>"#)
    );
}

#[test]
fn every_render_parameter_in_order() {
    let router = route_table::router();
    assert_eq!(route_table::BASE, "");
    assert_eq!(route_table::PATHS, ["/", "/books", "/books/:id"]);
    assert_eq!(route_table::ROUTES.len(), 2);
    let route = router.at("/books/dune");
    let state = stores::Stores::new(stores::CartState::new(["a", "b"], "Ada").coupon("SAVE"));
    let i18n = i18n::i18n("nl");
    assert_eq!(i18n::LOCALE, "en");
    assert_eq!(i18n::FALLBACK, ["en"]);
    assert_eq!(i18n::LOCALES.len(), 2);
    let literal = stores::Stores {
        cart: stores::CartState {
            lines: vec![Cow::Borrowed("a"), Cow::Borrowed("b")],
            owner: Cow::Borrowed("Ada"),
            coupon: Some(Cow::Borrowed("SAVE")),
        },
    };
    assert_eq!(literal.cart.lines, state.cart.lines);
    assert_eq!(literal.cart.coupon, state.cart.coupon);
    let teleports = Teleports::new();
    let provides = provides::Provides {
        theme_key: Some("dark"),
    };
    let head = Head::new();
    let page_props = books_id::Props::new("dune");
    let page = |out: &mut String| books_id::render(out, &page_props);
    let content = |out: &mut String, provides: provides::Provides<'_>| -> bool {
        themed_button::render(out, &themed_button::Props::new("inner"), provides);
        true
    };
    let slots = shell::Slots {
        default: Some(&content),
        router_view: Slot::new(&page),
    };
    let props = shell::Props::new("Shelf");
    let out = render(|out| {
        shell::render(
            out, &props, slots, &route, &state, &i18n, &teleports, provides, &head,
        )
    });
    assert!(out.contains("2 for Ada"), "{out}");
    assert!(out.contains("Hallo, Shelf!"), "{out}");
    assert!(
        out.contains(r#"<button type="button" class="dark">Shelf</button>"#),
        "{out}"
    );
    assert!(
        out.contains("<main><article>dune</article></main>"),
        "{out}"
    );
    assert!(
        out.contains(r#"<button type="button" class="dark">inner</button>"#),
        "{out}"
    );
    assert!(
        teleports
            .get("#modals")
            .is_some_and(|html| html.contains("<h2>Shelf</h2>"))
    );
    assert!(head.render().head_tags.contains("<title>Shelf</title>"));

    let (teleports, head) = (Teleports::new(), Head::new());
    let html = shell::html(
        &props, slots, &route, &state, &i18n, &teleports, provides, &head,
    );
    assert_eq!(html.into_string(), out);

    let scoped = |out: &mut String, provides: provides::Provides<'_>| -> bool {
        themed_button::render(out, &themed_button::Props::new("x"), provides);
        true
    };
    let scope = render(|out| {
        theme_scope::render(
            out,
            &theme_scope::Props::new("night"),
            theme_scope::Slots {
                default: Some(&scoped),
            },
            provides::Provides::default(),
        )
    });
    assert!(scope.contains(r#"class="night""#), "{scope}");
}

#[test]
fn twins_render_through_the_function_the_config_names() {
    let props = twins::StarRatingProps {
        value: 3,
        max: None,
    };
    let slots = twins::StarRatingSlots { default: None };
    assert_eq!(
        render(|out| crate::twins::star_rating(out, &props, slots, &ferrovue::Attrs::NONE)),
        r#"<span class="stars">3/5<!----></span>"#
    );
    assert!(render(|out| rated::render(out, &rated::Props::new(4))).contains("4/5"));
}

#[test]
fn a_page_records_the_parts_of_its_slots() {
    let router = route_table::router();
    let route = router.at("/");
    let state = stores::Stores::new(stores::CartState::new(Vec::<String>::new(), "Ada"));
    let i18n = i18n::i18n(i18n::LOCALE);
    let teleports = Teleports::new();
    let head = Head::new();
    let index = index::Props::new("Welcome");
    let greetings = [greeting::Props::new("Ada"), greeting::Props::new("Grace")];
    let mut page = Page::new();
    let parts = page.slot(
        "default",
        greetings
            .iter()
            .map(|props| Part::new(greeting::NAME, greeting::html(props))),
    );
    let view = page.slot("routerView", [Part::new(index::NAME, index::html(&index))]);
    let parts_slot = |out: &mut String, _: provides::Provides<'_>| -> bool {
        parts.slot().render_to(out);
        true
    };
    let slots = shell::Slots {
        default: Some(&parts_slot),
        router_view: view.slot(),
    };
    let props = shell::Props::new("Home");
    let mut out = String::new();
    let record = page.render_to(
        &mut out,
        shell::html(
            &props,
            slots,
            &route,
            &state,
            &i18n,
            &teleports,
            provides::Provides::default(),
            &head,
        ),
    );
    assert!(out.contains("<h1>Welcome</h1>"), "{out}");
    assert!(out.contains("Hello, Grace!"), "{out}");
    let mut script = String::new();
    record.script_into(&mut script, "__fv_page");
    assert!(
        script.contains(r#"{"c":"Greeting","p":{"name":"Ada"}}"#),
        "{script}"
    );
    assert!(
        script.contains(r#"{"c":"Index","p":{"heading":"Welcome"}}"#),
        "{script}"
    );
}

#[test]
fn render_json_renders_a_component_from_a_fixture() {
    assert_eq!(
        render_json("Greeting", r#"{"name":"Ada","unread":1,"showHead":true}"#).unwrap(),
        "<p>Hello, Ada!<b>1</b></p>"
    );
    let shell = render_json(
        "Shell",
        r#"{"title":"T","$slots":{"default":"<i>d</i>","routerView":"<p>v</p>"},"$route":"/books/x","$stores":{"cart":{"lines":["a"],"owner":"Ada"}},"$locale":"nl"}"#,
    )
    .unwrap();
    assert!(shell.contains("1 for Ada"), "{shell}");
    assert!(shell.contains("Hallo, T!"), "{shell}");
    assert!(shell.contains("<main><p>v</p></main>"), "{shell}");
    assert!(render_json("Nothing", "{}").is_err());
}
