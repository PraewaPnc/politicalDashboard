import requests
import pandas as pd
import re
from difflib import get_close_matches
import json

# --- Configuration ---
URL = "https://politigraph.wevis.info/graphql"

# Query to fetch all individual votes, including their unique 'id' and 'voter_party'
VOTES_QUERY = """
  query AllVotes {
    votes {
      id
      voter_party
    }
  }
"""

# Query to fetch the canonical list of organizations/parties
ORGANIZATIONS_QUERY = """
  query Organizations {
    organizations {
      name
    }
  }
"""

# --- Utility Functions ---

def flatten_graphql_response(response_json):
    if not isinstance(response_json, dict):
        raise ValueError("Expected a GraphQL response dict")

    data_section = response_json.get("data", {})
    if not data_section:
        raise ValueError("No 'data' key found in GraphQL response")

    data = None
    for k, v in data_section.items():
        if isinstance(v, list):
            data = v
            break
    
    if data is None:
        raise ValueError("No list-type data found inside 'data'")

    df = pd.json_normalize(data, sep='.')
    return df


def clean_text(s):
    """Clean up the party name text (remove special characters and spaces)."""
    if pd.isna(s) or s is None: 
        return ""
    s = str(s).strip()
    s = re.sub(r'[^\u0E00-\u0E7Fa-zA-Z0-9\s]', '', s)
    s = re.sub(r'\s+', '', s)  # Remove all spaces
    return s


def to_canonical(s, canon_list, cutoff=0.6):
    """Find the closest canonical match using fuzzy matching."""
    if pd.isna(s) or s == '':
        return s
    match = get_close_matches(s, canon_list, n=1, cutoff=cutoff)
    if match:
        return match[0]
    return s


def generate_cleaned_party_map():
    print("Fetching votes and organizations data...")
    try:
        # 1. Fetch Votes Data
        votes_response = requests.post(URL, json={'query': VOTES_QUERY})
        votes_response.raise_for_status()
        df_votes = flatten_graphql_response(votes_response.json())

        # 2. Fetch Canonical Organizations Data
        org_response = requests.post(URL, json={'query': ORGANIZATIONS_QUERY})
        org_response.raise_for_status()
        df_org = flatten_graphql_response(org_response.json())

    except requests.exceptions.RequestException as e:
        print(f"Error fetching data from API: {e}. Cannot proceed.")
        return {}
    except ValueError as e:
        print(f"Error processing GraphQL response: {e}. Cannot proceed.")
        return {}

    # ✅ Replace null/NaN/None and too-short strings with 'อื่นๆ'
    df_votes['voter_party'] = df_votes['voter_party'].fillna('อื่นๆ')
    df_votes.loc[df_votes['voter_party'].isin([None, '', 'nan', 'NaN']), 'voter_party'] = 'อื่นๆ'

    # ✅ Replace short strings (length <= 2) with 'อื่นๆ'
    df_votes['voter_party'] = df_votes['voter_party'].apply(
        lambda x: 'อื่นๆ' if isinstance(x, str) and len(x.strip()) <= 2 else x
    )

    # 3. Prepare Canonical List
    canonical_list = df_org['name'].unique().tolist() + ['สมาชิกวุฒิสภา', 'อื่นๆ']

    # 4. Clean and Map Party Names
    df_votes['party_clean'] = df_votes['voter_party'].apply(clean_text)
    df_votes['voter_party_final'] = df_votes['party_clean'].apply(
        lambda x: to_canonical(x, canonical_list)
    )

    # ✅ Add "พรรค" prefix except for 'สมาชิกวุฒิสภา' and 'อื่นๆ'
    df_votes['voter_party_final'] = df_votes['voter_party_final'].apply(
        lambda x: f"พรรค{x}" if x not in ['สมาชิกวุฒิสภา', 'อื่นๆ'] and not str(x).startswith('พรรค') else x
    )

    # 5. Create Final Mapping
    if 'id' not in df_votes.columns or 'voter_party_final' not in df_votes.columns:
        print("Required columns ('id' or 'voter_party_final') are missing.")
        return {}
        
    vote_party_map = dict(zip(df_votes['id'], df_votes['voter_party_final']))
    
    # 6. Save to JSON
    output_filename = 'cleaned_party_map.json'
    with open(output_filename, 'w', encoding='utf-8') as f:
        json.dump(vote_party_map, f, ensure_ascii=False, indent=2)

    print(f"✅ Successfully generated and saved map to {output_filename}")
    print(f"Total entries: {len(vote_party_map)}")
    return vote_party_map


if __name__ == "__main__":
    generate_cleaned_party_map()
