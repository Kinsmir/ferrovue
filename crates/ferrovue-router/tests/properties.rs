//! Properties of the router that hold for every input.

use ferrovue_router::Router;
use proptest::prelude::*;

proptest! {
    #[test]
    fn any_location_and_link_resolve_without_panicking(at in any::<String>(), to in any::<String>()) {
        let router = Router::new(&["/", "/a/:x", "/a/:x/b", "/w/:rest(.*)"]);
        let at = format!("/{at}");
        let _ = router.at(&at).link(&to);
    }

    #[test]
    fn a_link_to_where_the_reader_is_is_active(segment in "[a-zA-Z0-9_~-]{1,12}") {
        let router = Router::new(&["/", "/a/:x", "/a/:x/b"]);
        let at = format!("/a/{segment}");
        let route = router.at(&at);
        prop_assert!(route.link(&at).active);
        let with_query = format!("{at}?q=1#h");
        prop_assert!(route.link(&with_query).active, "the query and hash do not matter");
        let deeper = format!("{at}/b");
        prop_assert!(!route.link(&deeper).active);
    }

    #[test]
    fn an_absolute_link_keeps_its_query_and_hash_as_written(path in "/[a-z/]{0,10}", query in "[a-z=&]{0,6}", hash in "[a-z]{0,6}") {
        let router = Router::new(&["/"]);
        let to = format!("{path}?{query}#{hash}");
        prop_assert_eq!(router.at("/").link(&to).href, to);
    }
}
