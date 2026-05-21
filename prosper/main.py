import requests
import streamlit as st
import pandas as pd
from typing import TypedDict

PAGE_LIMIT = 25
OFFSET = -25


def getListings():
    global OFFSET
    OFFSET += PAGE_LIMIT

    return requests.get(
        "https://api.prosper.com/listingsvc/v2/listings/",
        headers={
            "Authorization": "bearer <access_token>",
            "Accept": "application/json",
            "timezone": "America/Chicago"
        },
        params={
            "biddable": True,
            "invested": False,
            "limit": PAGE_LIMIT,
            "offset": OFFSET,
            "employment_status_description": "employed",
            "fico_score": "760-779,780-799,800-819,820-850",
            "listing_category_id": "1,2,5,6,8,12",
            "prosper_rating": "AA,A,B",
            "verification_stage_min": "3",
            "g094s_max": "1",
            "g099s_max": "0",
            "g980s_max": "5",
        }
    )


class BidRequest(TypedDict):
    bid_amount: float
    listing_id: int


def placeOrder(bids: list[BidRequest]) -> requests.Response:
    return requests.post(
        "https://api.prosper.com/orders/",
        headers={
            "Authorization": "bearer <access_token>",
            "Accept": "application/json",
            "timezone": "America/Chicago"
        },
        json={"bid_requests": bids}
    )


# -------------------------
# DATA
# -------------------------
listings = getListings()
data = listings.json()

df = pd.json_normalize(data["result"], sep=".")

# keep only needed cols (adjust as needed)
df = df[["listing_number", "prosper_score", "lender_yield"]]

st.title("Prosper Listings")

# -------------------------
# STATE (IMPORTANT FIX)
# -------------------------
if "selected" not in st.session_state:
    st.session_state.selected = set()


# -------------------------
# STABLE CHECKBOX TABLE
# -------------------------
edited_rows = []

for _, row in df.iterrows():
    checked = st.checkbox(
        f"{row['listing_number']}",
        value=row["listing_number"] in st.session_state.selected,
        key=f"cb_{row['listing_number']}"
    )

    if checked:
        st.session_state.selected.add(row["listing_number"])
    else:
        st.session_state.selected.discard(row["listing_number"])

    edited_rows.append(row)


# -------------------------
# SHORTLIST
# -------------------------
shortlisted = df[df["listing_number"].isin(st.session_state.selected)]

st.subheader("Shortlisted")
st.write(shortlisted.to_dict("records"))


# -------------------------
# BID BUILDER
# -------------------------
def build_bids(selected_ids):
    return [
        {
            "listing_id": int(lid),
            "bid_amount": 25.0
        }
        for lid in selected_ids
    ]


# -------------------------
# CONFIRM BUTTON
# -------------------------
st.divider()

if st.button("Confirm & Place Order", type="primary"):

    if not st.session_state.selected:
        st.warning("No listings selected.")
    else:
        bids = build_bids(st.session_state.selected)

        st.json(bids)

        try:
            response = placeOrder(bids)

            if response.status_code == 200:
                st.success("Order placed successfully!")
                st.write(response.json())
            else:
                st.error(response.text)

        except Exception as e:
            st.error(str(e))
